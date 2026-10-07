import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  createBackup,
  listBackups,
  resolveBackupArchive,
  restoreBackup,
  type BackupTargets,
} from './index.js';

const scratch: string[] = [];

function tmpDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bifrost-${label}-`));
  scratch.push(dir);
  return dir;
}

/**
 * A minimal repo tree: storage/ (db + upload + tmp junk), .env, and a stray
 * themes/ that a backup must leave out since PLAN-35.
 */
function makeRepo(): { targets: BackupTargets } {
  const base = tmpDir('bkp-repo');
  const storageRoot = path.join(base, 'storage');
  const dataDir = path.join(storageRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(storageRoot, 'uploads', 'photo.bin'), 'IMAGE-BYTES');
  fs.writeFileSync(path.join(storageRoot, 'tmp', 'aborted.part'), 'HALF-UPLOAD');

  const themesDir = path.join(base, 'themes');
  fs.mkdirSync(themesDir, { recursive: true });
  fs.writeFileSync(path.join(themesDir, 'midnight.json'), '{"id":"midnight"}');

  const envFile = path.join(base, '.env');
  fs.writeFileSync(envFile, 'HEIMDALL_PIN=supersecret\n');

  const dbFile = path.join(dataDir, 'app.db');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT)');
  db.prepare('INSERT INTO note (body) VALUES (?)').run('remembered');
  db.close();

  return {
    targets: { base, storageRoot, dbFile, envFile, backupDir: path.join(base, 'backups') },
  };
}

function extract(archive: string): string {
  const dest = tmpDir('bkp-restore');
  restoreBackup({ archive, ...restoreRoots(dest) });
  return dest;
}

/** Restore target + its configured folders, as scripts/restore.ts passes them. */
function restoreRoots(base: string) {
  return { base, storageRoot: path.join(base, 'storage') };
}

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('createBackup', () => {
  it('archives storage/, and leaves out tmp/, .env and themes/ by default', () => {
    const { targets } = makeRepo();
    const { file, bytes } = createBackup(targets, { now: new Date('2026-07-21T10:00:00Z') });
    expect(fs.existsSync(file)).toBe(true);
    expect(bytes).toBeGreaterThan(0);

    const dest = extract(file);
    expect(fs.existsSync(path.join(dest, 'storage/data/app.db'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'storage/uploads/photo.bin'))).toBe(true);
    // tmp/ is boot-swept junk; .env holds secrets — both stay out. Themes are
    // client code in git since PLAN-35, so they are not backup state either.
    expect(fs.existsSync(path.join(dest, 'themes'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'storage/tmp/aborted.part'))).toBe(false);
    expect(fs.existsSync(path.join(dest, '.env'))).toBe(false);
  });

  it('captures a consistent db snapshot with its rows intact', () => {
    const { targets } = makeRepo();
    const { file } = createBackup(targets);
    const dest = extract(file);
    const db = new Database(path.join(dest, 'storage/data/app.db'), { readonly: true });
    const row = db.prepare('SELECT body FROM note').get() as { body: string };
    db.close();
    expect(row.body).toBe('remembered');
  });

  it('includes .env only with includeEnv', () => {
    const { targets } = makeRepo();
    const { file } = createBackup(targets, { includeEnv: true });
    const dest = extract(file);
    expect(fs.existsSync(path.join(dest, '.env'))).toBe(true);
  });

  it('rotates to the newest N archives when keep is set', () => {
    const { targets } = makeRepo();
    const first = createBackup(targets, { now: new Date('2026-07-21T10:00:00Z'), keep: 2 });
    createBackup(targets, { now: new Date('2026-07-21T11:00:00Z'), keep: 2 });
    const third = createBackup(targets, { now: new Date('2026-07-21T12:00:00Z'), keep: 2 });

    expect(third.pruned).toEqual([first.file]);
    const remaining = listBackups(targets.backupDir);
    expect(remaining).toHaveLength(2);
    expect(remaining.some((name) => first.file.endsWith(name))).toBe(false);
  });

  it('leaves excluded storage folders out but keeps the db and the rest', () => {
    const { targets } = makeRepo();
    fs.mkdirSync(path.join(targets.storageRoot, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(targets.storageRoot, 'logs', 'app.log'), '{"msg":"hi"}\n');
    const { file } = createBackup(targets, { exclude: ['uploads'] });
    const dest = extract(file);
    expect(fs.existsSync(path.join(dest, 'storage/uploads/photo.bin'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'storage/logs/app.log'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'storage/data/app.db'))).toBe(true);
  });

  it('rejects excluding data/ or a path-like entry', () => {
    const { targets } = makeRepo();
    expect(() => createBackup(targets, { exclude: ['data'] })).toThrow(/data/);
    expect(() => createBackup(targets, { exclude: ['../themes'] })).toThrow(/invalid/);
  });

  it('reports row counts and size of the archived db snapshot', () => {
    const { targets } = makeRepo();
    const { tables, dbBytes } = createBackup(targets);
    expect(tables).toEqual({ note: 1 });
    expect(dbBytes).toBeGreaterThan(0);
  });

  it('throws when the database is missing', () => {
    const { targets } = makeRepo();
    fs.rmSync(targets.dbFile);
    expect(() => createBackup(targets)).toThrow(/no database/);
  });
});

describe('restoreBackup', () => {
  it('refuses a live server unless forced', () => {
    const { targets } = makeRepo();
    const { file } = createBackup(targets);
    const dest = tmpDir('bkp-live');
    expect(() => restoreBackup({ archive: file, ...restoreRoots(dest), live: true })).toThrow(
      /running/,
    );
    // With --force it proceeds.
    restoreBackup({ archive: file, ...restoreRoots(dest), live: true, force: true });
    expect(fs.existsSync(path.join(dest, 'storage/data/app.db'))).toBe(true);
  });

  it('throws on a missing archive', () => {
    const dest = tmpDir('bkp-missing');
    expect(() =>
      restoreBackup({ archive: path.join(dest, 'nope.zip'), ...restoreRoots(dest) }),
    ).toThrow(
      /not found/,
    );
  });
});

describe('restoreBackup refuses hostile archives before extracting anything', () => {
  /**
   * Zip `entries` (path → content, or { link } for a symlink) from a scratch
   * dir. `rename` then swaps an entry's name bytes in place (same length, so
   * the zip stays valid) — how `../` and absolute names get in, since the zip
   * CLI won't store those itself.
   */
  function hostileZip(
    entries: Record<string, string | { link: string }>,
    rename?: [from: string, to: string],
  ): string {
    const src = tmpDir('bkp-hostile-src');
    for (const [name, value] of Object.entries(entries)) {
      const full = path.join(src, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (typeof value === 'string') fs.writeFileSync(full, value);
      else fs.symlinkSync(value.link, full);
    }
    const archive = path.join(tmpDir('bkp-hostile'), 'evil.zip');
    const zipped = spawnSync('zip', ['-qry', archive, ...Object.keys(entries)], { cwd: src });
    expect(zipped.status).toBe(0);
    if (rename) {
      const [from, to] = rename;
      expect(to.length).toBe(from.length);
      const bytes = fs.readFileSync(archive);
      fs.writeFileSync(
        archive,
        Buffer.from(bytes.toString('latin1').split(from).join(to), 'latin1'),
      );
    }
    return archive;
  }

  function attempt(archive: string): { error: unknown; dest: string } {
    const dest = tmpDir('bkp-hostile-dest');
    try {
      restoreBackup({ archive, ...restoreRoots(dest) });
      return { error: null, dest };
    } catch (error) {
      return { error, dest };
    }
  }

  function expectRefused(archive: string, reason: RegExp): void {
    const { error, dest } = attempt(archive);
    expect(String(error)).toMatch(/refusing to restore/);
    expect(String(error)).toMatch(reason);
    // Nothing at all was written — not even the entries that were fine.
    expect(fs.readdirSync(dest)).toEqual([]);
  }

  it('refuses an entry outside storage/, a legacy themes/ and .env', () => {
    const archive = hostileZip({ 'storage/ok.txt': 'ok', 'scripts/backup-agent.sh': 'evil' });
    expectRefused(archive, /"scripts\/backup-agent\.sh" is outside storage\/, themes\/ and \.env/);
  });

  it('restores an archive from before PLAN-35 and skips its themes/', () => {
    const archive = hostileZip({
      'storage/uploads/kept.txt': 'KEPT',
      'themes/old-one.json': '{}',
      'themes/old-two.json': '{}',
    });
    const dest = tmpDir('bkp-legacy-dest');
    expect(restoreBackup({ archive, ...restoreRoots(dest) })).toEqual({ skippedThemeFiles: 2 });
    expect(fs.readFileSync(path.join(dest, 'storage/uploads/kept.txt'), 'utf8')).toBe('KEPT');
    expect(fs.existsSync(path.join(dest, 'themes'))).toBe(false);
  });

  it('refuses a symlink entry', () => {
    const archive = hostileZip({ 'storage/logs': { link: '/etc' } });
    expectRefused(archive, /"storage\/logs" is a symlink/);
  });

  it('refuses a ../ traversal entry', () => {
    const archive = hostileZip({ 'storage/xx/evil.sh': 'evil' }, ['storage/xx/', 'storage/../']);
    expectRefused(archive, /climbs out/);
  });

  it('refuses an absolute-path entry', () => {
    const archive = hostileZip({ 'xstorage/evil.sh': 'evil' }, ['xstorage/', '/storage/']);
    expectRefused(archive, /absolute/);
  });

  it('refuses a hostile archive even with --force on a live server', () => {
    const archive = hostileZip({ 'server/src/app.ts': 'evil' });
    const dest = tmpDir('bkp-hostile-dest');
    expect(() =>
      restoreBackup({ archive, ...restoreRoots(dest), live: true, force: true }),
    ).toThrow(/refusing to restore/);
  });

  it('still restores a real backup that carries .env', () => {
    const { targets } = makeRepo();
    const { file } = createBackup(targets, { includeEnv: true });
    const { error, dest } = attempt(file);
    expect(error).toBeNull();
    expect(fs.existsSync(path.join(dest, '.env'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'storage/data/app.db'))).toBe(true);
  });
});

describe('resolveBackupArchive', () => {
  /** A scheduled-layout backup folder: <dir>/<name>/<name>.zip + meta.json. */
  function scheduled(dir: string, name: string): string {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name, `${name}.zip`), 'zip');
    fs.writeFileSync(path.join(dir, name, 'meta.json'), '{}');
    return path.join(dir, name, `${name}.zip`);
  }

  it('picks the newest backup from a folder of backup folders', () => {
    const dir = tmpDir('bkp-cloud');
    scheduled(dir, 'bifrost-backup-2026-09-01T03-00-00-000Z');
    const newest = scheduled(dir, 'bifrost-backup-2026-09-15T03-00-00-000Z');
    scheduled(dir, 'bifrost-backup-2026-08-18T03-00-00-000Z');
    // A half-moved run and a folder missing its zip never count.
    fs.mkdirSync(path.join(dir, '.incoming-bifrost-backup-2026-09-29T03-00-00-000Z'));
    fs.mkdirSync(path.join(dir, 'bifrost-backup-2026-09-30T03-00-00-000Z'));

    const resolved = resolveBackupArchive(dir);
    expect(resolved.archive).toBe(newest);
    expect(resolved.metaFile).toBe(path.join(path.dirname(newest), 'meta.json'));
    expect(resolved.pickedLatest).toBe(true);
  });

  it('uses exactly the given backup folder, even when it is not the newest', () => {
    const dir = tmpDir('bkp-cloud');
    const older = scheduled(dir, 'bifrost-backup-2026-09-01T03-00-00-000Z');
    scheduled(dir, 'bifrost-backup-2026-09-15T03-00-00-000Z');

    const resolved = resolveBackupArchive(path.dirname(older));
    expect(resolved.archive).toBe(older);
    expect(resolved.pickedLatest).toBe(false);
  });

  it('picks the newest zip from a flat BACKUP_DIR, with its .meta.json', () => {
    const dir = tmpDir('bkp-flat');
    fs.writeFileSync(path.join(dir, 'bifrost-backup-2026-09-01T03-00-00-000Z.zip'), 'zip');
    fs.writeFileSync(path.join(dir, 'bifrost-backup-2026-09-15T03-00-00-000Z.zip'), 'zip');
    fs.writeFileSync(path.join(dir, 'bifrost-backup-2026-09-15T03-00-00-000Z.meta.json'), '{}');

    const resolved = resolveBackupArchive(dir);
    expect(path.basename(resolved.archive)).toBe('bifrost-backup-2026-09-15T03-00-00-000Z.zip');
    expect(resolved.metaFile).toMatch(/2026-09-15T03-00-00-000Z\.meta\.json$/);
  });

  it('takes a .zip path as-is and rejects other files, empty folders, and missing paths', () => {
    const dir = tmpDir('bkp-misc');
    const zip = scheduled(dir, 'bifrost-backup-2026-09-01T03-00-00-000Z');
    expect(resolveBackupArchive(zip)).toMatchObject({ archive: zip, pickedLatest: false });

    const other = path.join(dir, 'notes.txt');
    fs.writeFileSync(other, 'x');
    expect(() => resolveBackupArchive(other)).toThrow(/not a backup archive/);
    expect(() => resolveBackupArchive(tmpDir('bkp-empty'))).toThrow(/no backups found/);
    expect(() => resolveBackupArchive(path.join(dir, 'nope'))).toThrow(/not found/);
  });
});
