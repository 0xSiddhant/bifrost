/**
 * `npm run backup [-- --include-env] [-- --meta]` — VACUUM INTO a consistent
 * SQLite copy and zip storage/ (minus tmp/ and BACKUP_EXCLUDE) plus themes/
 * into BACKUP_DIR, timestamped and rotated to the newest BACKUP_KEEP.
 * Online-safe: runs against a live server.
 *
 * `--meta` also writes `<archive>.meta.json` beside the zip — checksum, app
 * version, and per-table row counts — so two backups can be compared without
 * unzipping either. `scripts/backup-agent.sh` (the scheduled job) uses it.
 *
 * Thin wrapper — the real work is `core/backup`, which PLAN-10's in-app
 * "Backup now" button calls directly.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from '../server/src/core/config/index.js';
import { createBackup } from '../server/src/core/backup/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const config = loadConfig();
if (!config.backupDir) {
  console.error('✖ BACKUP_DIR is not set in .env — nowhere to write the backup.');
  process.exit(1);
}

const includeEnv = process.argv.includes('--include-env');
const writeMeta = process.argv.includes('--meta');

/** Chunked, so an archive larger than memory (or Node's 2 GB buffer cap) still hashes. */
function sha256(file: string): string {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let read: number;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function gitCommit(): string | null {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function dirStats(dir: string): { files: number; bytes: number } {
  if (!fs.existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = dirStats(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += fs.statSync(full).size;
    }
  }
  return { files, bytes };
}

try {
  const result = createBackup(
    {
      base: ROOT,
      storageRoot: config.storage.root,
      dbFile: config.storage.dbFile,
      themesDir: config.themes.dir,
      envFile: path.join(ROOT, '.env'),
      backupDir: config.backupDir,
    },
    { includeEnv, keep: config.backupKeep, exclude: config.backupExclude },
  );
  const mb = (result.bytes / 1024 / 1024).toFixed(1);
  console.log(`✔ backup written: ${result.file} (${mb} MB)${includeEnv ? ' [includes .env]' : ''}`);
  if (writeMeta) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
    const created = fs.statSync(result.file).mtime;
    const meta = {
      schema: 1,
      archive: path.basename(result.file),
      createdAt: created.toISOString(),
      createdAtEpoch: Math.floor(created.getTime() / 1000),
      host: os.hostname(),
      app: { version: pkg.version, commit: gitCommit() },
      archiveBytes: result.bytes,
      sha256: sha256(result.file),
      includesEnv: includeEnv,
      excluded: config.backupExclude,
      db: { bytes: result.dbBytes, tables: result.tables },
      logs: dirStats(config.storage.logs),
    };
    const metaFile = result.file.replace(/\.zip$/, '.meta.json');
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    console.log(`✔ meta written: ${metaFile}`);
  }
  if (result.pruned.length > 0) {
    console.log(`  rotated out ${result.pruned.length} older archive(s); keeping ${config.backupKeep}`);
  }
} catch (error) {
  console.error(`✖ backup failed: ${(error as Error).message}`);
  process.exit(1);
}
