/**
 * `npm run restore -- <path> [--force]` — extract a backup over the repo
 * (storage/ and themes/, and .env only if the archive carries it). Refuses to
 * run while a server is listening on PORT, since overwriting files under a live
 * process tears state; `--force` overrides.
 *
 * <path> may be:
 *   - a backup archive (`….zip`)                 → that archive
 *   - one backup's folder (`…/bifrost-backup-<stamp>`) → that backup only
 *   - a folder of backups (`…/Bifrost/backups`, or a flat BACKUP_DIR)
 *                                                → the newest one
 * When the backup has a meta file, its sha256 is checked before anything is
 * extracted — a corrupted or half-synced cloud copy is refused, not restored.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from '../server/src/core/config/index.js';
import { resolveBackupArchive, restoreBackup } from '../server/src/core/backup/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const args = process.argv.slice(2);
const force = args.includes('--force');
const target = args.find((arg) => !arg.startsWith('--'));
if (!target) {
  console.error('usage: npm run restore -- <archive.zip | backup folder | folder of backups> [--force]');
  process.exit(1);
}

const config = loadConfig();

async function serverIsLive(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

interface BackupMeta {
  createdAt?: string;
  app?: { version?: string; commit?: string | null };
  archiveBytes?: number;
  sha256?: string;
  db?: { tables?: Record<string, number> };
}

const live = await serverIsLive(config.port);
try {
  const { archive, metaFile, pickedLatest } = resolveBackupArchive(path.resolve(target));
  console.log(`▶ ${pickedLatest ? 'newest backup in that folder' : 'backup'}: ${archive}`);

  if (metaFile) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as BackupMeta;
    const tables = Object.keys(meta.db?.tables ?? {}).length;
    const created = meta.createdAt
      ? new Date(meta.createdAt).toLocaleString('en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
          hour12: true,
        })
      : 'unknown';
    console.log(`  created:       ${created} (local time)`);
    console.log(`  app version:   ${meta.app?.version ?? 'unknown'} (commit ${meta.app?.commit ?? 'unknown'})`);
    console.log(`  db tables:     ${tables}`);
    if (meta.sha256) {
      const actual = await sha256(archive);
      if (actual !== meta.sha256) {
        throw new Error(`checksum mismatch — archive is corrupt or not fully synced (expected ${meta.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
      }
      console.log('  checksum:      ✔ matches meta.json');
    }
  } else {
    console.log('  no meta file beside it — restoring without a checksum check');
  }

  restoreBackup({ archive, base: ROOT, force, live });
  console.log(`✔ restored ${archive}`);
  console.log('  Note: .env is restored only if the archive included it — recreate it otherwise.');
} catch (error) {
  console.error(`✖ restore failed: ${(error as Error).message}`);
  process.exit(1);
}
