import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { SettingsRow } from '../config/index.js';
import { SERVER_ROOT } from '../paths.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
}

export function openDb(dbFile: string): DbHandle {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const sqlite = new Database(dbFile);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');
  return { db: drizzle(sqlite, { schema }), sqlite };
}

/** Idempotent; Drizzle tracks applied migrations in-DB (__drizzle_migrations). */
export function runMigrations(handle: DbHandle): void {
  migrate(handle.db, { migrationsFolder: path.join(SERVER_ROOT, 'drizzle') });
}

export function readSettings(handle: DbHandle): SettingsRow[] {
  return handle.db
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .all();
}

/** Upsert one runtime setting (Heimdall edits, session epoch). Synchronous — better-sqlite3. */
export function writeSetting(handle: DbHandle, key: string, value: string): void {
  handle.db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: new Date().toISOString() },
    })
    .run();
}

/** Shutdown path: fold the WAL back into the main file, then close. */
export function checkpointAndClose(handle: DbHandle): void {
  handle.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  handle.sqlite.close();
}
