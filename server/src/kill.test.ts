/**
 * Kill test (required for any plan touching storage): boot the real server
 * process, hold an open SSE connection, SIGINT it, and prove a clean exit
 * with an intact WAL database.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const TSX_BIN = path.join(SERVER_DIR, '..', 'node_modules', '.bin', 'tsx');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | null = null;
let storageRoot: string;

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
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe('SIGINT resilience', () => {
  it(
    'exits cleanly mid-run with an open SSE connection; WAL intact on reopen',
    async () => {
      storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-kill-'));
      child = spawn(TSX_BIN, [path.join(SERVER_DIR, 'src', 'app.ts')], {
        cwd: SERVER_DIR,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          STORAGE_ROOT: storageRoot,
          PORT: String(PORT),
          HEIMDALL_PIN: '4321',
          LOG_LEVEL: 'info',
          DEPLOY_PROFILE: 'cloud', // skip mDNS in tests
        },
        stdio: 'ignore',
      });
      const exited = new Promise<number | null>((resolve) => {
        child?.on('exit', (code) => resolve(code));
      });

      await waitForHealth(20_000);

      // Hold an SSE stream open so shutdown has a live client to drain.
      const controller = new AbortController();
      const sse = await fetch(`${BASE}/api/events`, { signal: controller.signal });
      expect(sse.status).toBe(200);
      expect(sse.headers.get('content-type')).toContain('text/event-stream');

      child.kill('SIGINT');
      const code = await exited;
      expect(code).toBe(0);
      controller.abort();

      // Reopen the database: no corruption, WAL still the journal mode.
      const dbFile = path.join(storageRoot, 'data', 'app.db');
      const sqlite = new Database(dbFile);
      expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
      const tables = sqlite
        .prepare("select name from sqlite_master where type='table' and name='settings'")
        .all();
      expect(tables).toHaveLength(1);
      sqlite.close();
    },
    45_000,
  );
});
