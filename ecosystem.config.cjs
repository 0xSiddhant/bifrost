/**
 * PM2 process definitions — the production run mode on macOS (see docs/pm2.md).
 *
 *   ./bifrost service pm2 [--web docker|none] [--standalone] [--otel]
 *   sh scripts/start-pm2.sh [same flags]   # the same, before `npm install`
 *   pm2 startup && pm2 save                # survive reboots
 *
 * PLAN-36: two apps, `bifrost-api` (the API on loopback API_PORT) and
 * `bifrost-web` (the web host on PORT, which also answers for bifrost.local),
 * plus `bifrost-mdns` for a web host in Docker (PLAN-39). Which apps exist and
 * the launcher keys they get come from start-pm2.sh's flags, exported as
 * BIFROST_APPS and the keys themselves — never from .env (owner, 2026-10-09).
 * Run without the script, this defines the plain hub. The apps load the rest
 * of .env themselves.
 */
const apps = (process.env.BIFROST_APPS || 'api web').split(/\s+/).filter(Boolean);
const launcherEnv = {
  BIFROST_RUN: process.env.BIFROST_RUN || 'full',
  MDNS_ADVERTISER: process.env.MDNS_ADVERTISER || 'web',
  OTEL_ENABLED: process.env.OTEL_ENABLED || 'false',
};

const common = {
  cwd: __dirname,
  // Single instance each: SQLite (one writer) and mDNS are not cluster-safe.
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  watch: false,
  env: { NODE_ENV: 'production', ...launcherEnv },
  // PM2 stops/restarts with SIGINT, which is each process's graceful trigger.
  // Give it room before PM2 escalates to SIGKILL; matches the shutdown budget.
  kill_timeout: 10000,
  time: true,
};

const api = {
  ...common,
  name: 'bifrost-api',
  // bootstrap.js (not app.js) — app.js only self-starts as the direct entry,
  // and PM2 fork mode wraps the script, so it would exit immediately.
  script: 'server/dist/bootstrap.js',
  // --import, not an import inside bootstrap: ESM hoists, so initialising the
  // OTel SDK from application code would run after http/fastify were already
  // imported and the instrumentations would patch nothing (PLAN-16b).
  node_args: '--import ./server/dist/otel.js',
  // Restart if memory climbs — a stuck upload or leak recovers on its own.
  max_memory_restart: '512M',
  // Structured JSON logs are written by pino to storage/logs/; these files
  // only capture the process's own stdout/stderr (boot banner, crashes).
  out_file: 'storage/logs/pm2-api-out.log',
  error_file: 'storage/logs/pm2-api-error.log',
};

const web = {
  ...common,
  name: 'bifrost-web',
  script: 'web/dist/bootstrap.js',
  max_memory_restart: '256M',
  out_file: 'storage/logs/pm2-web-out.log',
  error_file: 'storage/logs/pm2-web-error.log',
};

const mdns = {
  ...common,
  name: 'bifrost-mdns',
  script: 'web/dist/advertise.js',
  max_memory_restart: '128M',
  out_file: 'storage/logs/pm2-mdns-out.log',
  error_file: 'storage/logs/pm2-mdns-error.log',
};

// The API first, so the web host's first proxied request has an upstream.
// Mirrors web/src/processes.ts, which `npm start` uses (and which is tested).
module.exports = {
  apps: [
    ...(apps.includes('api') ? [api] : []),
    ...(apps.includes('web') ? [web] : []),
    ...(apps.includes('mdns') ? [mdns] : []),
  ],
};
