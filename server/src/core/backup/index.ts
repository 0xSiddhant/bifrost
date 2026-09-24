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
 *   storage/            (everything except tmp/ and any `exclude`d folders;
 *                        data/app.db is the vacuumed copy)
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
  /**
   * Top-level storage/ folders to leave out (e.g. `uploads`, `downloads`).
   * Plain folder names only; `data` can never be excluded — it holds the db.
   * Restore is `unzip -o`, so an excluded folder is left as-is on restore.
   */
  exclude?: readonly string[];
  /** Injectable clock so tests get deterministic, distinct archive names. */
  now?: Date;
}

export interface CreateBackupResult {
  file: string;
  bytes: number;
  /** Archives deleted by rotation, absolute paths. */
  pruned: string[];
  /** Size of the vacuumed db snapshot inside the archive. */
  dbBytes: number;
  /** Row count per table, read from the same snapshot the archive holds. */
  tables: Record<string, number>;
}

export interface RestoreOptions {
  /** Archive to extract. */
  archive: string;
  /** Repo root to extract into (storage/ and themes/ are overwritten). */
  base: string;
  /**
   * The configured storage/ and themes/ folders (absolute, under `base`). An
   * archive may only write inside these, plus `.env` — see assertSafeArchive.
   */
  storageRoot: string;
  themesDir: string;
  /** Extract even if the server looks live. Never skips the entry check. */
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

/** Validate `exclude` up front — a bad entry must fail loudly, not widen or narrow the archive. */
function excludePatterns(storageRel: string, exclude: readonly string[] = []): string[] {
  return exclude.map((name) => {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
      throw new Error(`invalid backup exclude entry: "${name}" (expected a storage/ folder name)`);
    }
    if (name === 'data') throw new Error('backup exclude cannot contain "data" — it holds the database');
    return `${storageRel}/${name}/*`;
  });
}

function countRows(dbFile: string): Record<string, number> {
  const db = new Database(dbFile, { readonly: true });
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    const tables: Record<string, number> = {};
    for (const { name } of names) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number };
      tables[name] = row.n;
    }
    return tables;
  } finally {
    db.close();
  }
}

/** Like `run`, but returns stdout (for reading `unzip -Z` listings). */
function capture(cmd: string, args: string[], cwd: string): string {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`${cmd} exited ${result.status ?? 'null'}${stderr ? `: ${stderr}` : ''}`);
  }
  return result.stdout;
}

/**
 * Refuse an archive that could write anywhere a backup never does, BEFORE
 * extracting it. The checksum only proves an archive matches its meta.json —
 * restore also accepts archives with no meta, from a cloud folder others may
 * be able to write to. `unzip` itself already drops absolute paths and `../`,
 * but happily writes any other repo path (scripts/, server/…) and recreates
 * symlinks, which a later entry can write through. So every entry must be:
 * not a symlink, relative with no `..`, and inside the configured storage or
 * themes folder, or be `.env` exactly.
 */
function assertSafeArchive(options: RestoreOptions): void {
  const allowed = [rel(options.base, options.storageRoot), rel(options.base, options.themesDir)];
  const names = capture('unzip', ['-Z1', options.archive], options.base).split('\n').filter(Boolean);
  // Long listing, same order as -Z1; entry lines are the ones whose 2nd field
  // is the zip version ("3.0"). The first field is the unix mode ("l…" = link).
  const modes = capture('unzip', ['-Z', '-s', options.archive], options.base)
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 9 && /^\d+\.\d+$/.test(fields[1] ?? ''))
    .map((fields) => fields[0] as string);
  if (modes.length !== names.length) {
    throw new Error('could not read the archive listing reliably — refusing to restore');
  }

  names.forEach((name, i) => {
    const parts = name.split('/');
    let problem: string | null = null;
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\')) {
      problem = 'is an absolute or non-portable path';
    } else if (parts.includes('..')) {
      problem = 'climbs out of the restore folder (..)';
    } else if (modes[i]?.startsWith('l')) {
      problem = 'is a symlink';
    } else if (name !== '.env' && !allowed.some((root) => name === `${root}/` || name.startsWith(`${root}/`))) {
      problem = `is outside ${allowed.map((root) => `${root}/`).join(', ')} and .env`;
    }
    if (problem) throw new Error(`refusing to restore: archive entry "${name}" ${problem}`);
  });
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
  const excluded = excludePatterns(storageRel, options.exclude);

  // 1. Zip the live tree, skipping boot-swept tmp/, excluded folders, and the
  //    live db triplet (the WAL/SHM would make an inconsistent copy — replaced
  //    in step 2).
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
      ...excluded,
      dbRel,
      `${dbRel}-wal`,
      `${dbRel}-shm`,
    ],
    targets.base,
  );

  // 2. VACUUM INTO a consistent snapshot and add it at the db's archive path.
  const snapBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-backup-'));
  let dbBytes: number;
  let tables: Record<string, number>;
  try {
    const snapshot = path.join(snapBase, dbRel);
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    const source = new Database(targets.dbFile, { readonly: true });
    try {
      source.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    } finally {
      source.close();
    }
    dbBytes = fs.statSync(snapshot).size;
    tables = countRows(snapshot);
    run('zip', ['-q', file, dbRel], snapBase);
  } finally {
    fs.rmSync(snapBase, { recursive: true, force: true });
  }

  // 3. Optionally fold in .env.
  if (options.includeEnv && fs.existsSync(targets.envFile)) {
    run('zip', ['-q', file, rel(targets.base, targets.envFile)], targets.base);
  }

  const pruned = options.keep && options.keep > 0 ? prune(targets.backupDir, options.keep) : [];
  return { file, bytes: fs.statSync(file).size, pruned, dbBytes, tables };
}

export interface ResolvedBackup {
  /** The archive to extract. */
  archive: string;
  /** Its meta file (checksum, version, row counts), when one sits beside it. */
  metaFile: string | null;
  /** True when `target` was a folder of backups and the newest was picked. */
  pickedLatest: boolean;
}

const BACKUP_FOLDER_RE = /^bifrost-backup-[^/]*$/;

function metaFor(archive: string): string | null {
  const beside = [
    path.join(path.dirname(archive), 'meta.json'), // scheduled layout: one folder per backup
    archive.replace(/\.zip$/, '.meta.json'), // flat layout: `npm run backup -- --meta`
  ];
  return beside.find((file) => fs.existsSync(file)) ?? null;
}

/**
 * Turn what the owner points restore at into one archive:
 *
 * - a `.zip` file → that archive;
 * - one backup's folder (`…/bifrost-backup-<stamp>/`, holding its zip) → that
 *   backup, never another;
 * - a folder of backups (the scheduled `…/Bifrost/backups/` with one folder per
 *   backup, or a flat BACKUP_DIR of zips) → the newest, by its timestamped name.
 *
 * Only complete backups count: a scheduled backup folder is renamed into place
 * only after its zip landed, and `.incoming-*` leftovers never match.
 */
export function resolveBackupArchive(target: string): ResolvedBackup {
  if (!fs.existsSync(target)) throw new Error(`not found: ${target}`);
  if (fs.statSync(target).isFile()) {
    if (!target.endsWith('.zip')) throw new Error(`not a backup archive (.zip): ${target}`);
    return { archive: target, metaFile: metaFor(target), pickedLatest: false };
  }

  const names = fs.readdirSync(target);
  const zips = names.filter((name) => ARCHIVE_RE.test(name));
  const folders = names.filter(
    (name) =>
      BACKUP_FOLDER_RE.test(name) &&
      !name.endsWith('.zip') &&
      fs.statSync(path.join(target, name)).isDirectory() &&
      fs.existsSync(path.join(target, name, `${name}.zip`)),
  );

  // One backup's own folder: exactly its zip, no nested backups.
  if (folders.length === 0 && zips.length === 1 && BACKUP_FOLDER_RE.test(path.basename(target))) {
    const archive = path.join(target, zips[0] as string);
    return { archive, metaFile: metaFor(archive), pickedLatest: false };
  }

  // A folder of backups: newest wins. Stamps sort chronologically as text, so
  // compare folder names and zip names on the same `bifrost-backup-<stamp>` key.
  const candidates = [
    ...folders.map((name) => ({ key: name, archive: path.join(target, name, `${name}.zip`) })),
    ...zips.map((name) => ({ key: name.replace(/\.zip$/, ''), archive: path.join(target, name) })),
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // plain code-unit order, not locale
  const newest = candidates.at(-1);
  if (!newest) throw new Error(`no backups found in ${target}`);
  return { archive: newest.archive, metaFile: metaFor(newest.archive), pickedLatest: true };
}

export function restoreBackup(options: RestoreOptions): void {
  if (!fs.existsSync(options.archive)) throw new Error(`archive not found: ${options.archive}`);
  assertSafeArchive(options);
  if (options.live && !options.force) {
    throw new Error(
      'a server appears to be running — refusing to restore over live state. Stop it first, or pass --force.',
    );
  }
  fs.mkdirSync(options.base, { recursive: true });
  run('unzip', ['-o', '-q', options.archive, '-d', options.base], options.base);
}
