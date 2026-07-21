/**
 * Backup & restore (PLAN-09). Importable functions with thin CLI wrappers
 * (`scripts/backup.ts`, `scripts/restore.ts`); PLAN-10's "Backup now" button
 * will call `createBackup()` in-process, so the logic lives here in core rather
 * than in the script.
 *
 * Backup is online-safe — the SQLite file is copied with `VACUUM INTO`, which
 * is consistent under WAL with the server still writing. Only restore refuses a
 * live server (overwriting files under a running process would tear state).
 *
 * Archive layout mirrors the repo so restore is a plain extract into the root:
 *
 *   storage/            (everything except tmp/; data/app.db is the vacuumed copy)
 *   themes/             (user-added theme JSON — state outside storage/)
 *   .env                (only with includeEnv — secrets stay out by default)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

export interface BackupTargets {
  /** Base dir the archive entries are relative to (repo root in production). */
  base: string;
  /** Absolute path to storage/ (must live under base). */
  storageRoot: string;
  /** Absolute path to the live SQLite file (storage/data/app.db). */
  dbFile: string;
  /** Absolute path to themes/ (must live under base); skipped when absent. */
  themesDir: string;
  /** Absolute path to .env (only archived when includeEnv is set). */
  envFile: string;
  /** Directory the archive is written to (BACKUP_DIR). */
  backupDir: string;
}

export interface CreateBackupOptions {
  /** Include `.env` (PIN/secrets/limits). Off by default — secrets stay local. */
  includeEnv?: boolean;
  /** Keep only the newest N archives; 0 or undefined keeps all. */
  keep?: number;
  /** Injectable clock so tests get deterministic, distinct archive names. */
  now?: Date;
}

export interface CreateBackupResult {
  file: string;
  bytes: number;
  /** Archives deleted by rotation, absolute paths. */
  pruned: string[];
}

export interface RestoreOptions {
  /** Archive to extract. */
  archive: string;
  /** Repo root to extract into (storage/ and themes/ are overwritten). */
  base: string;
  /** Extract even if the server looks live. */
  force?: boolean;
  /** Whether a server is currently running (computed by the caller). */
  live?: boolean;
}

const ARCHIVE_PREFIX = 'bifrost-backup-';
const ARCHIVE_RE = /^bifrost-backup-.*\.zip$/;

/** ISO timestamp, filesystem-safe, still lexicographically chronological. */
function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

function rel(base: string, target: string): string {
  const relative = path.relative(base, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`backup target is not under the base directory: ${target}`);
  }
  return relative;
}

function run(cmd: string, args: string[], cwd: string): void {
  const result = spawnSync(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.error) throw new Error(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(`${cmd} exited ${result.status ?? 'null'}${stderr ? `: ${stderr}` : ''}`);
  }
}

export function listBackups(backupDir: string): string[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((name) => ARCHIVE_RE.test(name))
    .sort();
}

function prune(backupDir: string, keep: number): string[] {
  const all = listBackups(backupDir);
  const excess = all.slice(0, Math.max(0, all.length - keep));
  for (const name of excess) fs.rmSync(path.join(backupDir, name));
  return excess.map((name) => path.join(backupDir, name));
}

export function createBackup(
  targets: BackupTargets,
  options: CreateBackupOptions = {},
): CreateBackupResult {
  if (!fs.existsSync(targets.dbFile)) throw new Error(`no database at ${targets.dbFile}`);
  fs.mkdirSync(targets.backupDir, { recursive: true });

  const file = path.join(targets.backupDir, `${ARCHIVE_PREFIX}${stamp(options.now ?? new Date())}.zip`);
  if (fs.existsSync(file)) fs.rmSync(file);

  const storageRel = rel(targets.base, targets.storageRoot);
  const dbRel = rel(targets.base, targets.dbFile);

  // 1. Zip the live tree, skipping boot-swept tmp/ and the live db triplet
  //    (the WAL/SHM would make an inconsistent copy — replaced in step 2).
  const entries = [storageRel];
  if (fs.existsSync(targets.themesDir)) entries.push(rel(targets.base, targets.themesDir));
  run(
    'zip',
    [
      '-r',
      '-q',
      file,
      ...entries,
      '-x',
      `${storageRel}/tmp/*`,
      dbRel,
      `${dbRel}-wal`,
      `${dbRel}-shm`,
    ],
    targets.base,
  );

  // 2. VACUUM INTO a consistent snapshot and add it at the db's archive path.
  const snapBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-backup-'));
  try {
    const snapshot = path.join(snapBase, dbRel);
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    const source = new Database(targets.dbFile, { readonly: true });
    try {
      source.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    } finally {
      source.close();
    }
    run('zip', ['-q', file, dbRel], snapBase);
  } finally {
    fs.rmSync(snapBase, { recursive: true, force: true });
  }

  // 3. Optionally fold in .env.
  if (options.includeEnv && fs.existsSync(targets.envFile)) {
    run('zip', ['-q', file, rel(targets.base, targets.envFile)], targets.base);
  }

  const pruned = options.keep && options.keep > 0 ? prune(targets.backupDir, options.keep) : [];
  return { file, bytes: fs.statSync(file).size, pruned };
}

export function restoreBackup(options: RestoreOptions): void {
  if (!fs.existsSync(options.archive)) throw new Error(`archive not found: ${options.archive}`);
  if (options.live && !options.force) {
    throw new Error(
      'a server appears to be running — refusing to restore over live state. Stop it first, or pass --force.',
    );
  }
  fs.mkdirSync(options.base, { recursive: true });
  run('unzip', ['-o', '-q', options.archive, '-d', options.base], options.base);
}
