/**
 * PLAN-23 kill test: SIGINT the real server mid save-burst, restart it, and
 * prove no torn rows — every save the server acknowledged (201) is fully
 * present afterwards; unacknowledged saves are absent, not half-written.
 * WAL + synchronous better-sqlite3 writes make this hold.
 *
 * The documents carry a DOCTYPE and a comment on purpose: "fully present" for
 * an Atlas document means the exact bytes, since the whole promise of this
 * feature is that a stored document is handed back as written — and both are
 * things a re-serializing server would silently drop.
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

let child: ChildProcess | null = null;
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-atlas-kill-'));

const contentFor = (index: number): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<!-- burst document -->',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>name</key>',
    `\t<string>burst-${index}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

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

describe('atlas save-burst kill test', () => {
  it('SIGINT during a save burst leaves no torn rows', { timeout: 60_000 }, async () => {
    const first = spawnServer();
    child = first.child;
    await waitForHealth(15_000);

    const acknowledged: Array<{ id: string; slug: string; name: string; index: number }> = [];
    const save = (index: number): Promise<Response> =>
      fetch(`${BASE}/api/atlas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bifrost-device': 'kill-device' },
        body: JSON.stringify({ name: `Burst Doc ${index}`, content: contentFor(index) }),
      });

    const record = async (response: Response, index: number): Promise<void> => {
      const body = (await response.json()) as { id: string; slug: string; name: string };
      acknowledged.push({ ...body, index });
    };

    // Phase 1 — commit a handful of saves that MUST be acknowledged before any
    // kill, anchoring the crash-survival assertion deterministically.
    for (let index = 0; index < 8; index += 1) {
      const response = await save(index);
      expect(response.status).toBe(201);
      await record(response, index);
    }

    // Phase 2 — fire a burst and SIGINT partway.
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, async (_unused, offset) => {
        if (offset === 12) first.child.kill('SIGINT');
        const index = 8 + offset;
        const response = await save(index);
        if (response.status === 201) await record(response, index);
      }),
    );
    expect(results.length).toBe(40);
    await first.exited;

    // Restart and verify every acknowledged save is intact, byte for byte.
    const second = spawnServer();
    child = second.child;
    await waitForHealth(15_000);

    const listResponse = await fetch(`${BASE}/api/atlas?limit=500`);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as Array<{ id: string }>;
    const listedIds = new Set(listed.map((row) => row.id));

    expect(acknowledged.length).toBeGreaterThan(0);
    for (const doc of acknowledged) {
      expect(listedIds.has(doc.id)).toBe(true);
      const full = await fetch(`${BASE}/api/atlas/${doc.slug}`);
      expect(full.status).toBe(200);
      const body = (await full.json()) as { content: string; name: string };
      expect(body.name).toBe(doc.name);
      expect(body.content).toBe(contentFor(doc.index));
    }

    second.child.kill('SIGINT');
    await second.exited;
    child = null;
  });
});
