#!/bin/sh
# Build and run Bifrost under PM2 — the production run mode on macOS.
# Usage:  sh scripts/start-pm2.sh
# Idempotent: safe to re-run after code changes (rebuilds + restarts).
set -eu

# Repo root (this script lives in scripts/).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "▶ Bifrost · PM2 · $ROOT"

# 1. prerequisites
command -v node >/dev/null 2>&1 || { echo "✖ node not found — install Node.js >= 20"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "✖ npm not found"; exit 1; }

# 2. dependencies
if [ ! -d node_modules ]; then
  echo "▶ installing dependencies…"
  npm install
fi

# 3. .env + PIN guard (the server won't boot without a PIN)
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✔ created .env from .env.example"
fi
PIN="$(grep -E '^HEIMDALL_PIN=' .env | cut -d= -f2- | tr -d '[:space:]')"
if [ "${#PIN}" -lt 4 ]; then
  echo "✖ HEIMDALL_PIN is not set (need >= 4 chars). Edit .env, then re-run."
  exit 1
fi

# 4. storage + migrations, then build
echo "▶ setup (folders + migrations)…"
npm run setup
echo "▶ build…"
npm run build

# 5. pm2
if ! command -v pm2 >/dev/null 2>&1; then
  echo "▶ installing pm2 globally…"
  npm install -g pm2 || { echo "✖ 'npm install -g pm2' failed — try: sudo npm install -g pm2"; exit 1; }
fi
echo "▶ starting under pm2…"
pm2 startOrRestart ecosystem.config.cjs
pm2 save >/dev/null 2>&1 || true

# 6. show the URL
PORT="$(grep -E '^PORT=' .env | cut -d= -f2- | tr -d '[:space:]')"; [ -n "$PORT" ] || PORT=4646
NAME="$(grep -E '^MDNS_NAME=' .env | cut -d= -f2- | tr -d '[:space:]')"; [ -n "$NAME" ] || NAME=bifrost

echo ""
echo "✔ Bifrost is running under pm2."
echo "  open:    http://$NAME.local:$PORT"
echo "  logs:    pm2 logs bifrost"
echo "  status:  pm2 status"
echo "  stop:    pm2 stop bifrost"
echo ""
echo "  Start on boot (run once):  pm2 startup   # then run the command it prints"
