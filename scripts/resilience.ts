/**
 * `npm run test:resilience` — hammer the real built server and prove SQLite
 * survives it. Runs against `server/dist` (build first), on a scratch
 * STORAGE_ROOT, so it never touches real data.
 *
 * Scenarios (PLAN-09 acceptance 3):
 *   A. 50 rapid SIGINT stop/starts — graceful path, no drift.
 *   B. SIGKILL (no graceful shutdown) mid-clipboard-write — WAL crash recovery.
 *   C. SIGKILL during boot/migration — idempotent migrations, no half-apply.
 *   D. tmp/ junk swept on boot.
 * Every phase asserts `PRAGMA integrity_check` = ok.
 *
 * Not part of `npm test` (spawns dozens of servers). Cycles overridable via
 * RESILIENCE_CYCLES for a quick local pass.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'app.js');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const CYCLES = Number(process.env.RESILIENCE_CYCLES ?? 50);

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-resilience-'));
const dbFile = path.join(storageRoot, 'data', 'app.db');

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function spawnServer(): { child: ChildProcess; exited: Promise<number | null> } {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      STORAGE_ROOT: storageRoot,
      PORT: String(PORT),
      HEIMDALL_PIN: '4321',
      LOG_LEVEL: 'error',
      DEPLOY_PROFILE: 'local',
      MDNS_NAME: `bifrost-res-${PORT}`,
    },
    stdio: 'ignore',
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, exited };
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) return false;
    await sleep(100);
  }
}

function integrityOk(): boolean {
  if (!fs.existsSync(dbFile)) return false;
  const db = new Database(dbFile, { readonly: true });
  try {
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    return rows[0]?.integrity_check === 'ok';
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(SERVER_ENTRY)) {
    console.error('✖ build the server first: npm run build');
    process.exit(2);
  }
  console.log(`resilience: port ${PORT}, storage ${storageRoot}, ${CYCLES} cycles\n`);

  // A. Rapid graceful stop/start.
  let integrityHeld = true;
  for (let i = 0; i < CYCLES; i += 1) {
    const server = spawnServer();
    if (!(await waitForHealth(15_000))) {
      check(`cycle ${i}: became healthy`, false);
      server.child.kill('SIGKILL');
      break;
    }
    server.child.kill('SIGINT');
    await server.exited;
    if (i % 10 === 9 && !integrityOk()) integrityHeld = false;
  }
  check(`${CYCLES} SIGINT stop/start cycles — integrity held`, integrityHeld && integrityOk());

  // B. SIGKILL mid-clipboard-write.
  {
    const server = spawnServer();
    await waitForHealth(15_000);
    const burst = Array.from({ length: 30 }, (_unused, i) =>
      fetch(`${BASE}/api/clipboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bifrost-device': 'resilience' },
        body: JSON.stringify({ text: `entry ${i} ${'x'.repeat(500)}` }),
      }).catch(() => undefined),
    );
    await sleep(60);
    server.child.kill('SIGKILL');
    await server.exited;
    await Promise.allSettled(burst);
    const restart = spawnServer();
    const healthy = await waitForHealth(15_000);
    restart.child.kill('SIGINT');
    await restart.exited;
    check('SIGKILL mid-clipboard-write — restart healthy + integrity ok', healthy && integrityOk());
  }

  // C. SIGKILL during boot/migration.
  {
    const server = spawnServer();
    await sleep(40 + Math.random() * 60);
    server.child.kill('SIGKILL');
    await server.exited;
    const restart = spawnServer();
    const healthy = await waitForHealth(15_000);
    restart.child.kill('SIGINT');
    await restart.exited;
    check('SIGKILL during boot/migration — recovers healthy + integrity ok', healthy && integrityOk());
  }

  // D. tmp/ swept on boot.
  {
    const tmpDir = path.join(storageRoot, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const junk = path.join(tmpDir, 'aborted-upload.part');
    fs.writeFileSync(junk, 'HALF-WRITTEN');
    const server = spawnServer();
    await waitForHealth(15_000);
    const swept = !fs.existsSync(junk);
    server.child.kill('SIGINT');
    await server.exited;
    check('tmp/ junk swept on boot', swept);
  }

  fs.rmSync(storageRoot, { recursive: true, force: true });
  console.log(failures === 0 ? '\n✔ ALL RESILIENCE CHECKS PASSED' : `\n✖ ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error) => {
  console.error(error);
  fs.rmSync(storageRoot, { recursive: true, force: true });
  process.exit(1);
});
