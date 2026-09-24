/**
 * CLI entry: `npm run migrate -w server` (also invoked by scripts/setup.ts).
 * Deliberately reads only STORAGE_ROOT rather than the full config, so
 * migrations run on a fresh clone before HEIMDALL_PIN is set.
 */
import { loadDotenv } from '../config/dotenv.js';
import { resolveStoragePaths } from '../config/index.js';
import { openDb, runMigrations, checkpointAndClose } from './index.js';

loadDotenv();

// No './storage' fallback: STORAGE_ROOT is required, and a missing value here
// would silently create/migrate a fresh db in the wrong place.
if (!process.env.STORAGE_ROOT) {
  process.stderr.write('✖ STORAGE_ROOT is required — set it in .env (e.g. STORAGE_ROOT=./storage)\n');
  process.exit(1);
}
const storage = resolveStoragePaths(process.env.STORAGE_ROOT);
const handle = openDb(storage.dbFile);
try {
  runMigrations(handle);
  process.stdout.write(`migrations applied — db at ${storage.dbFile}\n`);
} finally {
  checkpointAndClose(handle);
}
