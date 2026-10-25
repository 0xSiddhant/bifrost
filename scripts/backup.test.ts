// The two backup entry points, run for real against a scratch storage tree:
// scripts/backup.ts (what `./bifrost backup --local` and CI call) and
// scripts/backup-agent.sh's `run` (what `./bifrost backup` and launchd call).
// core/backup's own tests cover the archive; these cover the wiring around
// it, which is where a backup that "needs a setting nobody sets" breaks.
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const run = promisify(execFile);
const scratch: string[] = [];

/** A storage tree with one table. Under the repo root: core/backup refuses storage outside it. */
function makeStorage(): string {
  const storage = fs.mkdtempSync(path.join(ROOT, '.scratch-backup-'));
  scratch.push(storage);
  fs.mkdirSync(path.join(storage, 'data'));
  const db = new Database(path.join(storage, 'data', 'app.db'));
  db.exec('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT)');
  db.prepare('INSERT INTO note (body) VALUES (?)').run('remembered');
  db.close();
  return storage;
}

function tmpDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bifrost-${label}-`));
  scratch.push(dir);
  return dir;
}

/**
 * Every setting the scripts read, so the repo's own .env (loaded for keys the
 * process lacks) never decides a result. Values must be non-empty: the agent
 * treats an empty process value as unset and falls back to .env.
 */
function env(storage: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    DEPLOY_PROFILE: 'local',
    PORT: '4646',
    HEIMDALL_PIN: 'test-pin',
    STORAGE_ROOT: storage,
    BACKUP_KEEP: '0',
    BACKUP_EXCLUDE: 'uploads',
    BACKUP_CLOUD_SUBDIR: 'backups',
    BACKUP_INTERVAL_DAYS: '14',
    ...extra,
  };
}

const sha256 = (file: string): string =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

describe('scripts/backup.ts', () => {
  it('refuses without --out, naming it', async () => {
    const result = run(TSX, ['scripts/backup.ts'], { cwd: ROOT, env: env(makeStorage()) });
    await expect(result).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('--out <dir> is required'),
    });
  });

  it('writes a zip and its meta into --out', async () => {
    const out = path.join(tmpDir('backup-out'), 'nested');
    await run(TSX, ['scripts/backup.ts', '--out', out, '--meta'], {
      cwd: ROOT,
      env: env(makeStorage()),
    });
    const files = fs.readdirSync(out).sort();
    expect(files).toHaveLength(2);
    const [meta, zip] = files as [string, string];
    expect(zip).toMatch(/^bifrost-backup-.*\.zip$/);
    const parsed = JSON.parse(fs.readFileSync(path.join(out, meta), 'utf8')) as {
      sha256: string;
      includesEnv: boolean;
      db: { tables: Record<string, number> };
    };
    expect(parsed.sha256).toBe(sha256(path.join(out, zip)));
    expect(parsed.includesEnv).toBe(false);
    expect(parsed.db.tables.note).toBe(1);
  });
});

// The agent is macOS-only (launchd, plutil), so this runs on the Mac, not in CI.
describe.skipIf(process.platform !== 'darwin')('scripts/backup-agent.sh run', () => {
  const agent = (args: string[], storage: string, extra: Record<string, string>) =>
    run('sh', ['scripts/backup-agent.sh', 'run', ...args], {
      cwd: ROOT,
      env: env(storage, { BACKUP_CLOUD: 'path', ...extra }),
    });
  /** A stand-in API that answers only the health check the agent asks. */
  let api: http.Server;
  let apiPort = '';

  beforeAll(async () => {
    api = http.createServer((req, res) => {
      res.writeHead(req.url === '/api/v1/health' ? 200 : 404).end('{"ok":true}');
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    apiPort = String((api.address() as AddressInfo).port);
  });
  afterAll(() => new Promise<void>((resolve) => api.close(() => resolve())));

  it('backs up into the cloud folder with --force, then skips while one is not due', async () => {
    const storage = makeStorage();
    const cloud = tmpDir('backup-cloud');
    const settings = { API_PORT: apiPort, BACKUP_CLOUD_ROOT: cloud };

    const first = await agent(['--force'], storage, settings);
    expect(first.stdout).toMatch(/ OK bifrost-backup-/);
    const backups = fs.readdirSync(path.join(cloud, 'backups'));
    expect(backups).toHaveLength(1);
    const folder = path.join(cloud, 'backups', backups[0] as string);
    const meta = JSON.parse(fs.readFileSync(path.join(folder, 'meta.json'), 'utf8')) as {
      sha256: string;
    };
    expect(meta.sha256).toBe(sha256(path.join(folder, `${backups[0]}.zip`)));
    // The run log lands in the scratch storage, never the repo's own.
    expect(fs.readFileSync(path.join(storage, 'logs', 'backup-agent.log'), 'utf8')).toMatch(/ OK /);

    const second = await agent([], storage, settings);
    expect(second.stdout).toMatch(/ SKIP not due/);
    expect(fs.readdirSync(path.join(cloud, 'backups'))).toHaveLength(1);
  });

  it('skips, without failing, while the API is down', async () => {
    const cloud = tmpDir('backup-cloud');
    // A port nothing listens on: bind one, then let it go.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const downPort = String((probe.address() as AddressInfo).port);
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const result = await agent(['--force'], makeStorage(), {
      API_PORT: downPort,
      BACKUP_CLOUD_ROOT: cloud,
    });
    expect(result.stdout).toMatch(/ SKIP API server not running/);
    expect(fs.existsSync(path.join(cloud, 'backups'))).toBe(false);
  });
});
