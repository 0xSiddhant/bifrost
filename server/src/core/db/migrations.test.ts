import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkpointAndClose, openDb, readSettings, runMigrations, writeSetting, type DbHandle } from './index.js';

/**
 * Data-only migrations, on both paths the db-migration skill requires: an
 * install that already has the old rows, and a database built from zero.
 */

const scratch: string[] = [];

function freshDb(): DbHandle {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-migrations-'));
  scratch.push(dir);
  return openDb(path.join(dir, 'app.db'));
}

/**
 * Forget that the newest `count` migrations ran, as on an install from before
 * them. Drizzle applies every migration newer than the newest one it recorded,
 * so a test of an older migration forgets the newer ones too and first undoes
 * their schema changes (see `undoRunestoneFormat`).
 */
function forgetNewestMigrations(handle: DbHandle, count = 1): void {
  for (let i = 0; i < count; i += 1) {
    handle.sqlite
      // Drizzle leaves `id` null in SQLite; `created_at` is the journal's own order.
      .prepare(
        'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)',
      )
      .run();
  }
}

/** Undo 0014 (PLAN-42) so it can apply again. */
function undoRunestoneFormat(handle: DbHandle): void {
  handle.sqlite.prepare('ALTER TABLE runestones DROP COLUMN format').run();
}

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('0013_drop_themes_disabled (PLAN-35)', () => {
  it('removes the orphaned theme-switcher row on an upgraded install, and keeps the household default', () => {
    const handle = freshDb();
    try {
      runMigrations(handle);
      writeSetting(handle, 'themes.disabled', 'tokyo,olympus');
      writeSetting(handle, 'themes.default', 'aurora');
      undoRunestoneFormat(handle);
      forgetNewestMigrations(handle, 2);

      runMigrations(handle);

      const keys = new Map(readSettings(handle).map((row) => [row.key, row.value]));
      expect(keys.has('themes.disabled')).toBe(false);
      expect(keys.get('themes.default')).toBe('aurora');
    } finally {
      checkpointAndClose(handle);
    }
  });

  it('builds a fresh database through the whole chain', () => {
    const handle = freshDb();
    try {
      runMigrations(handle);
      expect(readSettings(handle).some((row) => row.key === 'themes.disabled')).toBe(false);
      // Idempotent: a second boot applies nothing and breaks nothing.
      runMigrations(handle);
    } finally {
      checkpointAndClose(handle);
    }
  });
});

describe('0014_runestone_format (PLAN-42)', () => {
  const columns = (handle: DbHandle) =>
    handle.sqlite
      .prepare('SELECT name, type, "notnull", dflt_value FROM pragma_table_info(\'runestones\')')
      .all();

  it('marks every runestone saved before it as strict JSON', () => {
    const handle = freshDb();
    try {
      runMigrations(handle);
      // Back to the pre-PLAN-42 table, holding documents saved then.
      undoRunestoneFormat(handle);
      forgetNewestMigrations(handle);
      const insert = handle.sqlite.prepare(
        'INSERT INTO runestones (id, name, slug, content, author_device_id, size_bytes, created_at, modified_at) VALUES (?, ?, ?, ?, NULL, ?, 1, 1)',
      );
      insert.run('aaaaaa', 'Old One', 'old-one-aaaaaa', '{"a":1}', 7);
      insert.run('bbbbbb', 'Old Two', 'old-two-bbbbbb', '[1, 2]', 6);

      runMigrations(handle);

      const rows = handle.sqlite
        .prepare('SELECT id, format, content FROM runestones ORDER BY id')
        .all();
      expect(rows).toEqual([
        { id: 'aaaaaa', format: 'json', content: '{"a":1}' },
        { id: 'bbbbbb', format: 'json', content: '[1, 2]' },
      ]);
      expect(handle.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');

      // An upgraded install and a fresh one converge on the same table.
      const fresh = freshDb();
      try {
        runMigrations(fresh);
        expect(columns(handle)).toEqual(columns(fresh));
      } finally {
        checkpointAndClose(fresh);
      }
    } finally {
      checkpointAndClose(handle);
    }
  });

  it('defaults a row inserted without a format to json on a fresh database', () => {
    const handle = freshDb();
    try {
      runMigrations(handle);
      expect(columns(handle)).toContainEqual({
        name: 'format',
        type: 'TEXT',
        notnull: 1,
        dflt_value: "'json'",
      });
      handle.sqlite
        .prepare(
          "INSERT INTO runestones (id, name, slug, content, size_bytes, created_at, modified_at) VALUES ('cccccc', 'New', 'new-cccccc', '{}', 2, 1, 1)",
        )
        .run();
      expect(handle.sqlite.prepare('SELECT format FROM runestones').get()).toEqual({
        format: 'json',
      });
    } finally {
      checkpointAndClose(handle);
    }
  });
});
