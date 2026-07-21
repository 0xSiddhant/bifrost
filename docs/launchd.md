# Running Bifrost with launchd (dependency-free alternative to PM2)

`launchd` is macOS's built-in service manager — no `npm install -g` needed. It
gives the same result as [PM2](pm2.md): start on login/boot, restart on crash.
Pick one, not both.

## The plist

Save as `~/Library/LaunchAgents/local.bifrost.plist`, replacing the two
**`__…__`** placeholders:

- `__NODE__` — output of `which node` (e.g. `/opt/homebrew/bin/node`)
- `__REPO__` — absolute path to this repo (e.g. `/Users/you/Code/bifrost`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.bifrost</string>

  <key>ProgramArguments</key>
  <array>
    <string>__NODE__</string>
    <string>__REPO__/server/dist/app.js</string>
  </array>

  <!-- Run from the repo so .env, storage/, and themes/ resolve. -->
  <key>WorkingDirectory</key>
  <string>__REPO__</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>

  <!-- Start at login and keep it alive (SIGKILL-safe; see resilience suite). -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <!-- Graceful stop: launchd sends SIGTERM, which Bifrost drains + checkpoints. -->
  <key>ExitTimeOut</key>
  <integer>15</integer>

  <key>StandardOutPath</key>
  <string>__REPO__/storage/logs/launchd-out.log</string>
  <key>StandardErrorPath</key>
  <string>__REPO__/storage/logs/launchd-error.log</string>
</dict>
</plist>
```

## Load / unload

```bash
# build once
npm run build

# load (starts immediately, and on every login)
launchctl load ~/Library/LaunchAgents/local.bifrost.plist

# check it
launchctl list | grep bifrost          # a PID and exit code 0

# stop / start without unloading
launchctl stop local.bifrost
launchctl start local.bifrost

# reload after a rebuild
launchctl unload ~/Library/LaunchAgents/local.bifrost.plist
npm run build
launchctl load ~/Library/LaunchAgents/local.bifrost.plist
```

## Notes

- **Login vs boot:** a `LaunchAgent` (as above) starts when *you* log in — the
  right choice for a personal Mac. For a headless always-on box, move the plist
  to `/Library/LaunchDaemons/` (owned by root) so it starts at boot before
  login; mDNS and `storage/` permissions still apply.
- Bifrost loads `.env` itself from `WorkingDirectory`, so no secrets go in the
  plist. Set the PIN in `.env`.
- Logs: structured pino JSON is at `storage/logs/app.log` (`npm run logs`); the
  plist's `StandardOut/ErrorPath` only capture the boot banner and crashes.
