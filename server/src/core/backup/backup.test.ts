import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createBackup, listBackups, restoreBackup, type BackupTargets } from './index.js';

const scratch: string[] = [];

function tmpDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bifrost-${label}-`));
  scratch.push(dir);
  return dir;
}

/** A minimal repo tree: storage/ (db + upload + tmp junk), themes/, .env. */
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
    targets: { base, storageRoot, dbFile, themesDir, envFile, backupDir: path.join(base, 'backups') },
  };
}

function extract(archive: string): string {
  const dest = tmpDir('bkp-restore');
  restoreBackup({ archive, base: dest });
  return dest;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('createBackup', () => {
  it('archives storage/ and themes/, excludes tmp/ and .env by default', () => {
    const { targets } = makeRepo();
    const { file, bytes } = createBackup(targets, { now: new Date('2026-07-21T10:00:00Z') });
    expect(fs.existsSync(file)).toBe(true);
    expect(bytes).toBeGreaterThan(0);

    const dest = extract(file);
    expect(fs.existsSync(path.join(dest, 'storage/data/app.db'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'storage/uploads/photo.bin'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'themes/midnight.json'))).toBe(true);
    // tmp/ is boot-swept junk; .env holds secrets — both stay out.
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
    expect(() => restoreBackup({ archive: file, base: dest, live: true })).toThrow(/running/);
    // With --force it proceeds.
    restoreBackup({ archive: file, base: dest, live: true, force: true });
    expect(fs.existsSync(path.join(dest, 'storage/data/app.db'))).toBe(true);
  });

  it('throws on a missing archive', () => {
    const dest = tmpDir('bkp-missing');
    expect(() => restoreBackup({ archive: path.join(dest, 'nope.zip'), base: dest })).toThrow(
      /not found/,
    );
  });
});
