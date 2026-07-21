/**
 * `npm run backup [-- --include-env]` — VACUUM INTO a consistent SQLite copy
 * and zip storage/ (minus tmp/) plus themes/ into BACKUP_DIR, timestamped and
 * rotated to the newest BACKUP_KEEP. Online-safe: runs against a live server.
 *
 * Thin wrapper — the real work is `core/backup`, which PLAN-10's in-app
 * "Backup now" button calls directly.
 */
import path from 'node:path';
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
    { includeEnv, keep: config.backupKeep },
  );
  const mb = (result.bytes / 1024 / 1024).toFixed(1);
  console.log(`✔ backup written: ${result.file} (${mb} MB)${includeEnv ? ' [includes .env]' : ''}`);
  if (result.pruned.length > 0) {
    console.log(`  rotated out ${result.pruned.length} older archive(s); keeping ${config.backupKeep}`);
  }
} catch (error) {
  console.error(`✖ backup failed: ${(error as Error).message}`);
  process.exit(1);
}
