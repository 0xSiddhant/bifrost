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
  echo "▶ installing dependencies..."
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
echo "▶ setup (folders + migrations)..."
npm run setup
echo "▶ build..."
npm run build

# 5. pm2
if ! command -v pm2 >/dev/null 2>&1; then
  echo "▶ installing pm2 globally..."
  npm install -g pm2 || { echo "✖ 'npm install -g pm2' failed — try: sudo npm install -g pm2"; exit 1; }
fi
# PLAN-36: two apps, bifrost-api and bifrost-web; BIFROST_RUN picks which.
env_get() { v="$(grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"; [ -n "$v" ] && echo "$v" || echo "$2"; }
MODE="$(env_get BIFROST_RUN full)"
case "$MODE" in
  full) WANT="bifrost-api bifrost-web" ;;
  api)  WANT="bifrost-api" ;;
  web)  WANT="bifrost-web" ;;
  *) echo "✖ BIFROST_RUN must be full, api or web (got \"$MODE\")"; exit 1 ;;
esac
pm2_drop() { if pm2 describe "$1" >/dev/null 2>&1; then pm2 delete "$1" >/dev/null && echo "✔ removed pm2 app $1"; fi; }
# Upgrade first: the single app every install before PLAN-36 runs must be gone
# BEFORE the web host starts, or both would advertise bifrost.local and the
# old one would hold the port the new API needs.
pm2_drop bifrost
# Switching modes: drop the apps this mode does not run.
for app in bifrost-api bifrost-web; do
  case " $WANT " in *" $app "*) ;; *) pm2_drop "$app" ;; esac
done

echo "▶ starting under pm2 ($MODE: $WANT)..."
pm2 startOrRestart ecosystem.config.cjs
pm2 save >/dev/null 2>&1 || true

# 6. show the URL
PORT="$(env_get PORT 4646)"
NAME="$(env_get MDNS_NAME bifrost)"
API_PORT="$(env_get API_PORT $((PORT + 1)))"

echo ""
echo "✔ Bifrost ($MODE) is running under pm2."
case "$MODE" in
  full) echo "  open:    http://$NAME.local:$PORT" ;;
  web)  echo "  open:    http://$NAME.local:$PORT   (the standalone client; no API in this mode)" ;;
  api)  echo "  api:     http://127.0.0.1:$API_PORT   (no web page; the CLI: bifrost --host 127.0.0.1:$API_PORT)" ;;
esac
echo "  logs:    pm2 logs              # or: pm2 logs bifrost-api / bifrost-web"
echo "  status:  pm2 status"
echo "  stop:    pm2 stop $WANT"
echo ""
echo "  Start on boot (run once):  pm2 startup   # then run the command it prints"
