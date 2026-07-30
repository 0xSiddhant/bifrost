/**
 * PLAN-17b kill test: a move must leave the file in **exactly one** folder —
 * never both, never neither, never truncated (criteria 15 and 24).
 *
 * Two halves, because one alone would prove little:
 *  1. Kill the real server process while a publish is in flight, restart, and
 *     assert the invariant end to end.
 *  2. Reproduce the one window `placeFile` cannot close — a crash after the
 *     link into downloads/ but before the source was unlinked — and prove the
 *     boot sweep repairs it. Hitting that window with a real signal is not
 *     possible on purpose: `link()` is a single syscall, which is the whole
 *     reason the move is built on it rather than on open(wx) + rename.
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
const PAYLOAD = 'x'.repeat(512 * 1024);

let child: ChildProcess | null = null;
let storageRoot = '';

function spawnServer(): { child: ChildProcess; exited: Promise<number | null> } {
  const proc = spawn(TSX_BIN, [path.join(SERVER_DIR, 'src', 'app.ts')], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      STORAGE_ROOT: storageRoot,
      PORT: String(PORT),
      HEIMDALL_PIN: '4321',
      LOG_LEVEL: 'info',
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

/** Where the bytes ended up, and whether they are all there. */
function locate(name: string): { in: string[]; sizes: number[] } {
  const found: string[] = [];
  const sizes: number[] = [];
  for (const folder of ['uploads', 'downloads']) {
    const file = path.join(storageRoot, folder, name);
    if (fs.existsSync(file)) {
      found.push(folder);
      sizes.push(fs.statSync(file).size);
    }
  }
  return { in: found, sizes };
}

afterAll(() => {
  child?.kill('SIGKILL');
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe('SIGTERM mid-publish', () => {
  it(
    'leaves the file in exactly one folder, complete, and repairs a crashed move on boot',
    async () => {
      storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-pubkill-'));
      const uploads = path.join(storageRoot, 'uploads');
      const downloads = path.join(storageRoot, 'downloads');
      fs.mkdirSync(uploads, { recursive: true });
      fs.mkdirSync(downloads, { recursive: true });
      fs.writeFileSync(path.join(uploads, 'report.pdf'), PAYLOAD);

      const first = spawnServer();
      child = first.child;
      await waitForHealth(20_000);

      // Fire the move and kill without waiting for the answer.
      const publish = fetch(`${BASE}/api/files/report.pdf/publish`, { method: 'POST' }).catch(
        () => null,
      );
      child.kill('SIGTERM');
      await Promise.all([publish, first.exited]);

      const afterKill = locate('report.pdf');
      // Never neither, never truncated — the two failure modes that lose data.
      expect(afterKill.in.length).toBeGreaterThanOrEqual(1);
      for (const size of afterKill.sizes) expect(size).toBe(PAYLOAD.length);

      const second = spawnServer();
      child = second.child;
      await waitForHealth(20_000);

      // …and after a restart, exactly one.
      const afterRestart = locate('report.pdf');
      expect(afterRestart.in).toHaveLength(1);
      expect(afterRestart.sizes[0]).toBe(PAYLOAD.length);

      child.kill('SIGINT');
      expect(await second.exited).toBe(0);

      // Half two: hand-build the crash window (both names, one inode) and
      // prove the next boot resolves it in favour of downloads/.
      fs.writeFileSync(path.join(uploads, 'crashed.bin'), PAYLOAD);
      fs.linkSync(path.join(uploads, 'crashed.bin'), path.join(downloads, 'crashed.bin'));
      expect(locate('crashed.bin').in).toEqual(['uploads', 'downloads']);

      const third = spawnServer();
      child = third.child;
      await waitForHealth(20_000);

      const swept = locate('crashed.bin');
      expect(swept.in).toEqual(['downloads']);
      expect(swept.sizes[0]).toBe(PAYLOAD.length);

      // The repaired file is a normal download, listed like any other.
      const listing = (await (await fetch(`${BASE}/api/downloads`)).json()) as { name: string }[];
      expect(listing.map((entry) => entry.name)).toContain('crashed.bin');

      child.kill('SIGINT');
      expect(await third.exited).toBe(0);
      child = null;
    },
    120_000,
  );
});
