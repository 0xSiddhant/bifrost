/**
 * PLAN-24 kill test (criterion 18): SIGKILL a folder upload in flight and the
 * folder must hold **either nothing or the complete file** — never a partial
 * or zero-byte one.
 *
 * The invariant is structural rather than lucky: the bytes are written to a
 * private tmp file first, and only a single `link()` syscall puts them under
 * their final name, so there is no moment at which a truncated file is visible
 * inside downloads/. The worst a crash can leave is the empty directory the
 * `mkdir` created — a benign state a person can delete in Finder, and one the
 * next upload simply reuses.
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
const BOUNDARY = 'BifrostKillBoundary';
const PAYLOAD = 'x'.repeat(24 * 1024 * 1024);

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
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('server never became healthy');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function multipartPayload(name: string, content: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="${name}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

afterAll(() => {
  child?.kill('SIGKILL');
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe('SIGKILL mid folder-upload', () => {
  it('leaves no partial or zero-byte file in downloads/<folder>/, and at worst an empty folder', async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-folderkill-'));
    for (const dir of ['uploads', 'downloads', 'tmp']) {
      fs.mkdirSync(path.join(storageRoot, dir), { recursive: true });
    }

    const first = spawnServer();
    child = first.child;
    await waitForHealth(20_000);

    // Fire and kill without waiting for the answer.
    const upload = fetch(`${BASE}/api/files?folder=Kill%20test`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      body: multipartPayload('big.bin', PAYLOAD),
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 250));
    child.kill('SIGKILL');
    await Promise.all([upload, first.exited]);

    const folder = path.join(storageRoot, 'downloads', 'Kill test');
    if (fs.existsSync(folder)) {
      expect(fs.statSync(folder).isDirectory()).toBe(true);
      for (const name of fs.readdirSync(folder)) {
        // Whatever is there is whole — the only two legal states.
        expect(fs.statSync(path.join(folder, name)).size, name).toBe(PAYLOAD.length);
      }
    }

    // A restart finds a usable state either way, and the same folder name is
    // reusable rather than something the next upload trips over.
    const second = spawnServer();
    child = second.child;
    await waitForHealth(20_000);

    const response = await fetch(`${BASE}/api/files?folder=Kill%20test`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      body: multipartPayload('after.txt', 'complete'),
    });
    expect(response.status).toBe(201);
    // Drain the body: an unread response holds its socket open, and the
    // graceful shutdown below waits for connections to drain.
    await response.json();
    expect(fs.readFileSync(path.join(folder, 'after.txt'), 'utf8')).toBe('complete');
    // Nothing half-written was left in tmp/ across the crash either.
    expect(fs.readdirSync(path.join(storageRoot, 'tmp'))).toEqual([]);

    // Shut it down, but do not assert a clean exit code here: a server
    // started after a SIGKILLed predecessor on the same port exits 130 on
    // SIGINT rather than 0, on develop as much as on this branch. Graceful
    // shutdown is publish-kill.test.ts's subject; this test's subject is
    // what the folder holds.
    child.kill('SIGINT');
    await second.exited;
    child = null;
  }, 120_000);
});
