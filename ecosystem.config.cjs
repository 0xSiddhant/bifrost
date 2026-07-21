/**
 * PM2 process definition — the production run mode on macOS (see docs/pm2.md).
 *
 *   npm run build                     # produce server/dist + client/dist
 *   pm2 start ecosystem.config.cjs    # run it
 *   pm2 startup && pm2 save           # survive reboots
 *
 * The app loads .env itself (relative to this directory) and advertises over
 * mDNS, so nothing here injects config beyond NODE_ENV.
 */
module.exports = {
  apps: [
    {
      name: 'bifrost',
      script: 'server/dist/app.js',
      cwd: __dirname,
      // Single instance: SQLite (one writer) and mDNS are not cluster-safe.
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      // Restart if memory climbs — a stuck upload or leak recovers on its own.
      max_memory_restart: '512M',
      // PM2 stops/restarts with SIGINT, which is the server's graceful trigger
      // (drain uploads → close SSE/chokidar → checkpoint DB). Give it room
      // before PM2 escalates to SIGKILL; matches the shutdown budget.
      kill_timeout: 10000,
      // Structured JSON logs are written by pino to storage/logs/ (that's what
      // the observability stack tails). These files only capture the process's
      // own stdout/stderr (boot banner, crashes).
      out_file: 'storage/logs/pm2-out.log',
      error_file: 'storage/logs/pm2-error.log',
      time: true,
    },
  ],
};
