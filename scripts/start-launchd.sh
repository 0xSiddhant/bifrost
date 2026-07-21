#!/bin/sh
# Build and run Bifrost under launchd — dependency-free always-on on macOS.
# Usage:  sh scripts/start-launchd.sh
# Idempotent: safe to re-run after code changes (rebuilds + reloads).
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LABEL="local.bifrost"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
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

# 5. write the plist (node path + repo path filled in for you)
echo "▶ writing $PLIST..."
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT/server/dist/bootstrap.js</string>
  </array>
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
  <string>$ROOT/storage/logs/launchd-out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/storage/logs/launchd-error.log</string>
</dict>
</plist>
PLISTEOF

# 6. (re)load the service
echo "▶ (re)loading service..."
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

# 7. show the URL
PORT="$(grep -E '^PORT=' .env | cut -d= -f2- | tr -d '[:space:]')"; [ -n "$PORT" ] || PORT=4646
NAME="$(grep -E '^MDNS_NAME=' .env | cut -d= -f2- | tr -d '[:space:]')"; [ -n "$NAME" ] || NAME=bifrost

echo ""
echo "✔ Bifrost loaded under launchd (starts now + on every login)."
echo "  open:    http://$NAME.local:$PORT"
echo "  status:  launchctl list | grep bifrost"
echo "  logs:    npm run logs      # or storage/logs/launchd-*.log"
echo "  stop:    launchctl unload $PLIST"
