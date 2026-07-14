/**
 * PLAN-02 kill test: SIGINT the real server process while an upload is
 * mid-stream, then restart it and prove no partial file surfaced in uploads/,
 * tmp was swept on boot, and the downloads listing reconciled correctly.
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

let child: ChildProcess | null = null;
let storageRoot: string;

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
      DEPLOY_PROFILE: 'local', // file-transfer only loads in the local profile
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

/** An endless multipart body: preamble, then 64 KB chunks forever. */
function endlessUpload(): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(64 * 1024).fill(97);
  let sentPreamble = false;
  return new ReadableStream({
    async pull(controller) {
      if (!sentPreamble) {
        sentPreamble = true;
        controller.enqueue(
          new TextEncoder().encode(
            `--${BOUNDARY}\r\n` +
              `Content-Disposition: form-data; name="files"; filename="never-finishes.bin"\r\n` +
              `Content-Type: application/octet-stream\r\n\r\n`,
          ),
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      controller.enqueue(chunk);
    },
  });
}

async function pollUntil(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

afterAll(() => {
  child?.kill('SIGKILL');
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe('SIGINT mid-upload', () => {
  it(
    'aborts the stream, publishes nothing, and a restart sweeps tmp and reconciles downloads',
    async () => {
      storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-upkill-'));
      fs.mkdirSync(path.join(storageRoot, 'downloads'), { recursive: true });
      fs.writeFileSync(path.join(storageRoot, 'downloads', 'survivor.txt'), 'still here');

      const first = spawnServer();
      child = first.child;
      await waitForHealth(20_000);

      const controller = new AbortController();
      const upload = fetch(`${BASE}/api/files`, {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
        body: endlessUpload(),
        // Required for streaming request bodies.
        duplex: 'half',
        signal: controller.signal,
      }).catch(() => null);

      // The upload is genuinely mid-flight once its tmp file exists on disk.
      const tmpDir = path.join(storageRoot, 'tmp');
      await pollUntil(() => fs.readdirSync(tmpDir).length > 0, 10_000, 'tmp file to appear');

      child.kill('SIGINT');
      const code = await first.exited;
      expect(code).toBe(0);
      controller.abort();
      await upload;

      // Crash contract: nothing half-written ever surfaces in uploads/.
      expect(fs.readdirSync(path.join(storageRoot, 'uploads'))).toEqual([]);

      const second = spawnServer();
      child = second.child;
      await waitForHealth(20_000);

      // Boot swept the junk and the watcher's initial scan rebuilt the listing.
      expect(fs.readdirSync(tmpDir).filter((name) => name !== '.gitkeep')).toEqual([]);
      expect(fs.readdirSync(path.join(storageRoot, 'uploads'))).toEqual([]);
      const listing = (await (await fetch(`${BASE}/api/downloads`)).json()) as {
        name: string;
      }[];
      expect(listing).toHaveLength(1);
      expect(listing[0]?.name).toBe('survivor.txt');

      child.kill('SIGINT');
      expect(await second.exited).toBe(0);
      child = null;
    },
    60_000,
  );
});
