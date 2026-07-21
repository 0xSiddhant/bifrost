/**
 * `npm run restore -- <archive.zip> [--force]` — extract a backup over the repo
 * (storage/ and themes/, and .env only if the archive carries it). Refuses to
 * run while a server is listening on PORT, since overwriting files under a live
 * process tears state; `--force` overrides.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from '../server/src/core/config/index.js';
import { restoreBackup } from '../server/src/core/backup/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const args = process.argv.slice(2);
const force = args.includes('--force');
const archive = args.find((arg) => !arg.startsWith('--'));
if (!archive) {
  console.error('usage: npm run restore -- <archive.zip> [--force]');
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

const live = await serverIsLive(config.port);
try {
  restoreBackup({ archive: path.resolve(archive), base: ROOT, force, live });
  console.log(`✔ restored ${archive}`);
  console.log('  Note: .env is restored only if the archive included it — recreate it otherwise.');
} catch (error) {
  console.error(`✖ restore failed: ${(error as Error).message}`);
  process.exit(1);
}
