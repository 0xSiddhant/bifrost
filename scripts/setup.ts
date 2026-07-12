/**
 * `npm run setup` — one-shot bootstrap for a fresh clone:
 * storage folders, .env from template, DB migrations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const STORAGE_DIRS = ['uploads', 'downloads', 'tmp', 'data', 'logs'];
for (const dir of STORAGE_DIRS) {
  const full = path.join(ROOT, 'storage', dir);
  fs.mkdirSync(full, { recursive: true });
  const gitkeep = path.join(full, '.gitkeep');
  if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');
}
console.log(`✔ storage folders ready (${STORAGE_DIRS.join(', ')})`);

const envFile = path.join(ROOT, '.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), envFile);
  console.log('✔ .env created from .env.example');
} else {
  console.log('✔ .env already present');
}

const envContent = fs.readFileSync(envFile, 'utf8');
const pinIsSet = /^HEIMDALL_PIN=.{4,}/m.test(envContent);

const migrate = spawnSync('npm', ['run', 'migrate', '-w', 'server'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (migrate.status !== 0) {
  console.error('✖ migrations failed');
  process.exit(1);
}

console.log('\nBifrost setup complete.');
if (!pinIsSet) {
  console.log('⚠ HEIMDALL_PIN is empty in .env — set it before starting the server.');
}
console.log('Next: npm run dev');
