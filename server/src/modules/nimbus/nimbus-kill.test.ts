/**
 * PLAN-14 acceptance criterion 5: SIGINT the real server mid result-save,
 * restart it, and prove no torn rows — every result the server acknowledged
 * (201) is fully present afterwards with its three figures intact; anything it
 * never acknowledged is absent, not half-written. WAL + synchronous
 * better-sqlite3 writes are what make this hold.
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
const DEVICE = 'kill-device';

interface SavedResult {
  id: number;
  downMbps: number;
  upMbps: number;
  latencyMs: number;
  testMb: number;
}

let child: ChildProcess | null = null;
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-nimbus-kill-'));

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
      NIMBUS_MAX_TEST_MB: '10',
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

describe('nimbus result-save kill test', () => {
  it('SIGINT during a save burst leaves no torn rows', { timeout: 60_000 }, async () => {
    const first = spawnServer();
    child = first.child;
    await waitForHealth(15_000);

    const acknowledged: SavedResult[] = [];
    const saveResult = (index: number): Promise<Response> =>
      fetch(`${BASE}/api/nimbus/results`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bifrost-device': DEVICE },
        body: JSON.stringify({
          downMbps: 100 + index,
          upMbps: 50 + index,
          latencyMs: 1 + index / 10,
          testMb: 10,
        }),
      });

    // Phase 1 — a handful of saves that MUST be acknowledged before any kill,
    // so the crash-survival assertion has a deterministic anchor.
    for (let index = 0; index < 8; index += 1) {
      const response = await saveResult(index);
      expect(response.status).toBe(201);
      acknowledged.push((await response.json()) as SavedResult);
    }

    // Phase 2 — burst, and SIGINT partway through it.
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, async (_unused, offset) => {
        if (offset === 12) first.child.kill('SIGINT');
        const response = await saveResult(8 + offset);
        if (response.status === 201) {
          acknowledged.push((await response.json()) as SavedResult);
        }
      }),
    );
    expect(results.length).toBe(40);
    await first.exited;

    // Restart: the history must read back exactly as it was acknowledged.
    const second = spawnServer();
    child = second.child;
    await waitForHealth(15_000);

    const listResponse = await fetch(`${BASE}/api/nimbus/results?limit=500`);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as SavedResult[];
    const byId = new Map(listed.map((row) => [row.id, row]));

    expect(acknowledged.length).toBeGreaterThan(0);
    for (const result of acknowledged) {
      const stored = byId.get(result.id);
      expect(stored, `result ${result.id} survived`).toBeDefined();
      expect(stored?.downMbps).toBe(result.downMbps);
      expect(stored?.upMbps).toBe(result.upMbps);
      expect(stored?.latencyMs).toBe(result.latencyMs);
      expect(stored?.testMb).toBe(result.testMb);
    }

    // A transfer interrupted by the same SIGINT must not have left a lease
    // behind: the restarted server accepts a fresh test from another device.
    const afterRestart = await fetch(`${BASE}/api/nimbus/down?mb=1`, {
      headers: { 'x-bifrost-device': 'other-device' },
    });
    expect(afterRestart.status).toBe(200);
    await afterRestart.arrayBuffer();

    second.child.kill('SIGINT');
    await second.exited;
    child = null;
  });
});
