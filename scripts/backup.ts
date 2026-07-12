/**
 * `npm run backup` — zip storage/ into BACKUP_DIR with a timestamped name.
 * tmp/ is excluded (boot-swept junk); logs, db, uploads, downloads included.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const backupDir = process.env.BACKUP_DIR;
if (!backupDir) {
  console.error('✖ BACKUP_DIR is not set in .env — nowhere to write the backup.');
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `bifrost-backup-${stamp}.zip`);

const zip = spawnSync('zip', ['-r', '-q', target, 'storage', '-x', 'storage/tmp/*'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (zip.status !== 0) {
  console.error('✖ zip failed');
  process.exit(1);
}

const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`✔ backup written: ${target} (${size} MB)`);
