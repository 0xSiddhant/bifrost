#!/bin/sh
# Build and run Bifrost under launchd — dependency-free always-on on macOS.
# Usage:  sh scripts/start-launchd.sh
# Idempotent: safe to re-run after code changes (rebuilds + reloads).
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
AGENTS="$HOME/Library/LaunchAgents"
# PLAN-36: two services, the API and the web host. LEGACY is the single plist
# every install before PLAN-36 has; re-running this script replaces it.
LEGACY_LABEL="local.bifrost"
API_LABEL="local.bifrost.api"
WEB_LABEL="local.bifrost.web"
# PLAN-39: the native advertiser, for a web host in Docker on the Mac.
MDNS_LABEL="local.bifrost.mdns"
echo "▶ Bifrost · launchd · $ROOT"

# 1. prerequisites
command -v node >/dev/null 2>&1 || { echo "✖ node not found — install Node.js >= 20"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "✖ npm not found"; exit 1; }
NODE_BIN="$(command -v node)"

# 2. dependencies
if [ ! -d node_modules ]; then
  echo "▶ installing dependencies..."
  npm install
fi

# 3. .env + PIN guard
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✔ created .env from .env.example"
fi
PIN="$(grep -E '^HEIMDALL_PIN=' .env | cut -d= -f2- | tr -d '[:space:]')"
if [ "${#PIN}" -lt 4 ]; then
  echo "✖ HEIMDALL_PIN is not set (need >= 4 chars). Edit .env, then re-run."
  exit 1
fi

# 4. setup + build
echo "▶ setup (folders + migrations)..."
npm run setup
echo "▶ build..."
npm run build

# 5. which processes this run mode needs (BIFROST_RUN: full | api | web)
env_get() { v="$(grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"; [ -n "$v" ] && echo "$v" || echo "$2"; }
MODE="$(env_get BIFROST_RUN full)"
case "$MODE" in
  full) WANT="api web" ;;
  api)  WANT="api" ;;
  web)  WANT="web" ;;
  *) echo "✖ BIFROST_RUN must be full, api or web (got \"$MODE\")"; exit 1 ;;
esac
ADVERTISER="$(env_get MDNS_ADVERTISER web)"
case "$ADVERTISER" in
  host) WANT="$WANT mdns" ;;
  web|off) ;;
  *) echo "✖ MDNS_ADVERTISER must be web, host or off (got \"$ADVERTISER\")"; exit 1 ;;
esac

remove_plist() {
  label="$1"; plist="$AGENTS/$label.plist"
  if [ -f "$plist" ]; then
    launchctl unload "$plist" 2>/dev/null || true
    rm -f "$plist"
    echo "✔ removed $label"
  fi
}

# Upgrade first: the old single process must be gone BEFORE the web host
# starts, or both would advertise bifrost.local and hold the API's port.
if [ -f "$AGENTS/$LEGACY_LABEL.plist" ]; then
  echo "▶ upgrading from the single-process service ($LEGACY_LABEL)..."
  remove_plist "$LEGACY_LABEL"
fi
# Switching modes: drop the services this mode does not run.
case " $WANT " in *" api "*) ;; *) remove_plist "$API_LABEL" ;; esac
case " $WANT " in *" web "*) ;; *) remove_plist "$WEB_LABEL" ;; esac
case " $WANT " in *" mdns "*) ;; *) remove_plist "$MDNS_LABEL" ;; esac

# 6. write one plist per process (node path + repo path filled in for you)
write_plist() {
  label="$1"; name="$2"; shift 2
  plist="$AGENTS/$label.plist"
  args=""
  for arg in "$@"; do args="$args    <string>$arg</string>
"; done
  echo "▶ writing $plist..."
  mkdir -p "$AGENTS"
  cat > "$plist" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ExitTimeOut</key>
  <integer>15</integer>
  <key>StandardOutPath</key>
  <string>$ROOT/storage/logs/launchd-$name-out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/storage/logs/launchd-$name-error.log</string>
</dict>
</plist>
PLISTEOF
}

# 7. (re)load: the API first, so the web host's first request has an upstream.
for name in $WANT; do
  if [ "$name" = api ]; then
    write_plist "$API_LABEL" api "$NODE_BIN" --import "$ROOT/server/dist/otel.js" "$ROOT/server/dist/bootstrap.js"
    label="$API_LABEL"
  elif [ "$name" = web ]; then
    write_plist "$WEB_LABEL" web "$NODE_BIN" "$ROOT/web/dist/bootstrap.js"
    label="$WEB_LABEL"
  else
    write_plist "$MDNS_LABEL" mdns "$NODE_BIN" "$ROOT/web/dist/advertise.js"
    label="$MDNS_LABEL"
  fi
  launchctl unload "$AGENTS/$label.plist" 2>/dev/null || true
  launchctl load "$AGENTS/$label.plist"
  echo "✔ loaded $label"
done

# 8. show the URL
PORT="$(env_get PORT 4646)"
NAME="$(env_get MDNS_NAME bifrost)"
API_PORT="$(env_get API_PORT $((PORT + 1)))"

echo ""
echo "✔ Bifrost ($MODE) loaded under launchd (starts now + on every login)."
case "$MODE" in
  full) echo "  open:    http://$NAME.local:$PORT" ;;
  web)  echo "  open:    http://$NAME.local:$PORT   (the standalone client; no API in this mode)" ;;
  api)  echo "  api:     http://127.0.0.1:$API_PORT   (no web page; the CLI: bifrost --host 127.0.0.1:$API_PORT)" ;;
esac
if [ "$ADVERTISER" = host ]; then
  echo "  name:    bifrost-mdns answers for $NAME.local here (MDNS_ADVERTISER=host)"
  echo "  web:     the web host runs in Docker: docker compose -f compose/web.yml -f compose/web.bridge.yml --env-file .env up -d"
fi
echo "  status:  launchctl list | grep bifrost"
echo "  logs:    npm run logs      # or storage/logs/launchd-*.log"
echo "  stop:    launchctl unload $AGENTS/local.bifrost.*.plist"
