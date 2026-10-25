/**
 * `npm run setup` — one-shot bootstrap for a fresh clone:
 * storage folders, .env from template, DB migrations.
 *
 * Also warns when an existing .env has drifted from .env.example: .env is only
 * copied once, so keys added by later plans never reach it on their own. The
 * server still runs (every key has a default), but the owner can't see or tune
 * what isn't there. Also run by scripts/start-pm2.sh and start-launchd.sh.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { ConfigError, loadConfig } from '../server/src/core/config/index.js';
import { LAUNCHER_KEYS } from '../server/src/core/config/dotenv.js';
import { askForPin, dropLauncherKeys, pinIsSet, updateMovedDefaults } from './env-file.js';

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

// No hand edits needed (owner, 2026-10-09): leftover run-shape keys go, and a
// missing PIN is asked for once when there is a terminal to ask on.
for (const line of dropLauncherKeys(envFile)) {
  console.log(`✔ removed ${line} from .env: the launcher's flags decide that now`);
}
for (const change of updateMovedDefaults(envFile)) console.log(`✔ updated .env: ${change}`);
if (!pinIsSet(envFile)) await askForPin(envFile);

const envContent = fs.readFileSync(envFile, 'utf8');
const pinSet = pinIsSet(envFile);

/** Keys set on active `KEY=` lines; with `includeCommented`, `# KEY=` lines too. */
function envKeys(content: string, includeCommented: boolean): Set<string> {
  const re = includeCommented ? /^#?\s*([A-Z][A-Z0-9_]*)=/gm : /^([A-Z][A-Z0-9_]*)=/gm;
  return new Set(Array.from(content.matchAll(re), (m) => m[1] as string));
}

const templateContent = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
// A key the template lists (even commented out) counts as present in .env if
// it appears there active or commented — commenting one out is a choice.
const inEnv = envKeys(envContent, true);
const missing = [...envKeys(templateContent, false)].filter((key) => !inEnv.has(key));
// Active .env keys the template never mentions: usually a typo or a removed setting.
const known = envKeys(templateContent, true);
const isLauncherKey = (key: string): boolean => (LAUNCHER_KEYS as readonly string[]).includes(key);
const unknown = [...envKeys(envContent, false)].filter(
  (key) => !known.has(key) && !isLauncherKey(key),
);

// Validate .env the way the server will, before migrating or building: a
// missing required key (DEPLOY_PROFILE, STORAGE_ROOT) or a bad value stops
// setup here — so start-pm2.sh / start-launchd.sh never hand pm2 a server
// that crash-loops on boot. HEIMDALL_PIN is the one exception: a fresh clone
// legitimately runs setup before the PIN is set, so it stays a warning below.
const envValues = Object.fromEntries(
  Object.entries(dotenv.parse(envContent)).filter(([key]) => !isLauncherKey(key)),
);
let ports = '';
try {
  const config = loadConfig({ ...envValues, ...process.env });
  ports = describePorts(config.port, config.webHost, config.api.host, config.api.port);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  const problems = error.message
    .split('\n')
    .filter((line) => line.startsWith('  - ') && !line.startsWith('  - HEIMDALL_PIN:'));
  if (problems.length > 0) {
    console.error(`✖ .env is invalid — the server would refuse to start:\n${problems.join('\n')}`);
    process.exit(1);
  }
}

const migrate = spawnSync('npm', ['run', 'migrate', '-w', 'server'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (migrate.status !== 0) {
  console.error('✖ migrations failed');
  process.exit(1);
}

console.log('\nBifrost setup complete.');
if (ports) console.log(ports);
if (!pinSet) {
  console.log('⚠ HEIMDALL_PIN is empty in .env — set it before starting the server.');
}
if (missing.length > 0) {
  console.log(
    `⚠ .env is missing ${missing.length} key(s) from .env.example (built-in defaults apply;` +
      ` copy them over to see or tune them):\n    ${missing.join(', ')}`,
  );
}
if (unknown.length > 0) {
  console.log(
    `⚠ .env sets ${unknown.length} key(s) .env.example doesn't know (typo or removed setting?):` +
      `\n    ${unknown.join(', ')}`,
  );
}
console.log('Next: npm run dev');

/** PLAN-36: which ports this install uses. Which of them run is the launcher's call. */
function describePorts(port: number, webHost: string, apiHost: string, apiPort: number): string {
  return `✔ ports: web host on ${webHost}:${port} → API on ${apiHost}:${apiPort}`;
}
