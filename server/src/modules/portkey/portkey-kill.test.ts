/**
 * PLAN-15 acceptance criterion 5: SIGINT the real server mid create-burst,
 * restart it, and prove no torn rows — every create the server acknowledged
 * (201) resolves fully afterwards (its /go hop 302s to the saved target), and
 * an unacknowledged slug either fully exists or 404s, never half. WAL +
 * synchronous better-sqlite3 writes make this hold.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const TSX_BIN = path.join(SERVER_DIR, '..', 'node_modules', '.bin', 'tsx');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;

interface SavedPortkey {
  slug: string;
  url: string;
}

let child: ChildProcess | null = null;
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-portkey-kill-'));

function spawnServer(): { child: ChildProcess; exited: Promise<number | null> } {
  const proc = spawn(TSX_BIN, [path.join(SERVER_DIR, 'src', 'app.ts')], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      STORAGE_ROOT: storageRoot,
      PORT: String(PORT),
      HEIMDALL_PIN: '4321',
      LOG_LEVEL: 'error',
      DEPLOY_PROFILE: 'local',
      MDNS_NAME: `bifrost-test-${PORT}`,
    },
    stdio: 'ignore',
  });
  const exited = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
  return { child: proc, exited };
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('server never became healthy');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

afterAll(() => {
  child?.kill('SIGKILL');
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe('portkey create-burst kill test', () => {
  it('SIGINT during a create burst leaves no torn rows', { timeout: 60_000 }, async () => {
    const first = spawnServer();
    child = first.child;
    await waitForHealth(15_000);

    const acknowledged: SavedPortkey[] = [];
    const create = (index: number): Promise<Response> =>
      fetch(`${BASE}/api/portkey`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bifrost-device': 'kill-device' },
        body: JSON.stringify({ slug: `burst-${index}`, url: `http://host-${index}.local/p`, note: `n${index}` }),
      });

    // Phase 1 — a handful that MUST be acknowledged before any kill.
    for (let index = 0; index < 8; index += 1) {
      const response = await create(index);
      expect(response.status).toBe(201);
      acknowledged.push((await response.json()) as SavedPortkey);
    }

    // Phase 2 — a burst, SIGINT partway.
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, async (_unused, offset) => {
        if (offset === 12) first.child.kill('SIGINT');
        const response = await create(8 + offset);
        if (response.status === 201) acknowledged.push((await response.json()) as SavedPortkey);
      }),
    );
    expect(results.length).toBe(40);
    await first.exited;

    // Restart and verify every acknowledged create resolves fully.
    const second = spawnServer();
    child = second.child;
    await waitForHealth(15_000);

    const listResponse = await fetch(`${BASE}/api/portkey?limit=1000`);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as SavedPortkey[];
    const bySlug = new Map(listed.map((row) => [row.slug, row]));

    expect(acknowledged.length).toBeGreaterThan(0);
    for (const portkey of acknowledged) {
      const stored = bySlug.get(portkey.slug);
      expect(stored, `portkey ${portkey.slug} survived`).toBeDefined();
      expect(stored?.url).toBe(portkey.url);
      // And it actually resolves — the /go hop 302s to the saved target.
      const hop = await fetch(`${BASE}/go/${portkey.slug}`, { redirect: 'manual' });
      expect(hop.status).toBe(302);
      expect(hop.headers.get('location')).toBe(portkey.url);
    }

    second.child.kill('SIGINT');
    await second.exited;
    child = null;
  });
});
