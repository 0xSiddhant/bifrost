# Running Bifrost with launchd (dependency-free alternative to PM2)

`launchd` is macOS's built-in service manager — no `npm install -g` needed. It
gives the same result as [PM2](pm2.md): start on login/boot, restart on crash.
Pick one, not both.

**One command:** `sh scripts/start-launchd.sh` does everything below — builds,
writes the plists with your real node + repo paths filled in, and loads them.
The manual steps here are what it automates.

## Two services (PLAN-36)

Bifrost runs as two processes, so launchd runs two services:

| Label | What it is | Listens on |
|---|---|---|
| `local.bifrost.api` | the API server: REST, SSE, uploads, the database | `127.0.0.1:API_PORT` (default `PORT + 1`, 4647), never the LAN |
| `local.bifrost.web` | the web host: serves the client, forwards the API's paths, answers for `bifrost.local` | `WEB_HOST:PORT` (default `0.0.0.0:4646`) |

The address people open is unchanged: `http://bifrost.local:4646`.
`BIFROST_RUN` in `.env` decides which services exist: `full` (both, the
default), `api` or `web`. Re-running the script after changing it removes the
services the new mode does not run.

## Upgrading from the single `local.bifrost` service

Before PLAN-36 there was one plist, `local.bifrost`. Re-running
`sh scripts/start-launchd.sh` unloads and deletes it **first**, so the old
process can neither hold the API's port nor advertise `bifrost.local` beside
the web host, then writes and loads the two new ones. By hand:

```bash
launchctl unload ~/Library/LaunchAgents/local.bifrost.plist
rm ~/Library/LaunchAgents/local.bifrost.plist
```

If the web host is ever missing, the API logs an `error` ten seconds after it
starts: nothing is serving `PORT`, with the command that fixes it.

## The plists

Save as `~/Library/LaunchAgents/local.bifrost.api.plist` and
`~/Library/LaunchAgents/local.bifrost.web.plist`, replacing the two
**`__…__`** placeholders:

- `__NODE__` — output of `which node` (e.g. `/opt/homebrew/bin/node`)
- `__REPO__` — absolute path to this repo (e.g. `/Users/you/Code/bifrost`)

The API:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.bifrost.api</string>

  <key>ProgramArguments</key>
  <array>
    <string>__NODE__</string>
    <string>--import</string>
    <string>__REPO__/server/dist/otel.js</string>
    <string>__REPO__/server/dist/bootstrap.js</string>
  </array>

  <!-- Run from the repo so .env and storage/ resolve. -->
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
  <string>__REPO__/storage/logs/launchd-api-out.log</string>
  <key>StandardErrorPath</key>
  <string>__REPO__/storage/logs/launchd-api-error.log</string>
</dict>
</plist>
```

The web host is the same with three changes: the label `local.bifrost.web`,
`ProgramArguments` of `__NODE__` and `__REPO__/web/dist/bootstrap.js` alone,
and `launchd-web-out.log` / `launchd-web-error.log`.

## Load / unload

```bash
# build once
npm run build

# load (starts immediately, and on every login): the API first
launchctl load ~/Library/LaunchAgents/local.bifrost.api.plist
launchctl load ~/Library/LaunchAgents/local.bifrost.web.plist

# check them
launchctl list | grep bifrost          # two PIDs and exit code 0

# stop / start one without unloading (the page stays up while the API restarts)
launchctl stop local.bifrost.api
launchctl start local.bifrost.api

# reload after a rebuild: just re-run the script
sh scripts/start-launchd.sh
```

## Notes

- **Login vs boot:** a `LaunchAgent` (as above) starts when *you* log in — the
  right choice for a personal Mac. For a headless always-on box, move the plists
  to `/Library/LaunchDaemons/` (owned by root) so it starts at boot before
  login; mDNS and `storage/` permissions still apply.
- Bifrost loads `.env` itself from `WorkingDirectory`, so no secrets go in the
  plist. Set the PIN in `.env`.
- Logs: structured pino JSON is at `storage/logs/current.log` for the API
  (`npm run logs`) and `storage/logs/app-web.N.log` for the web host; the
  plists' `StandardOut/ErrorPath` only capture boot banners and crashes.
