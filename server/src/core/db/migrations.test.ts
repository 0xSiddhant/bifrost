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

/** Forget that the newest migration ran, as on an install from before it existed. */
function forgetNewestMigration(handle: DbHandle): void {
  handle.sqlite
    // Drizzle leaves `id` null in SQLite; `created_at` is the journal's own order.
    .prepare(
      'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)',
    )
    .run();
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
      forgetNewestMigration(handle);

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
