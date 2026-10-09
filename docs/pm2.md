# Running Bifrost with PM2 (production, macOS)

PM2 is the production run mode on the Mac: it keeps Bifrost alive across
crashes and reboots and handles logs. Native macOS (not Docker) is deliberate —
see [`docker-linux.md`](docker-linux.md) for why.

> Prefer zero dependencies? Use [`launchd`](launchd.md) instead — same outcome,
> nothing to `npm install -g`.

**One command:** `sh scripts/start-pm2.sh` does everything below (deps, `.env`
check, setup, build, start under PM2). The steps here are what it runs — do them
by hand when you want more control.

## Two apps (PLAN-36)

Bifrost runs as two processes, and PM2 manages each as its own app:

| App | What it is | Listens on |
|---|---|---|
| `bifrost-api` | the API server: REST, SSE, uploads, the database | `127.0.0.1:API_PORT` (default `PORT + 1`, 4647), never the LAN |
| `bifrost-web` | the web host: serves the client, forwards the API's paths to `bifrost-api`, answers for `bifrost.local` | `WEB_HOST:PORT` (default `0.0.0.0:4646`) |

The address people open is unchanged: `http://bifrost.local:4646`. Stopping
`bifrost-api` alone leaves the page loading and showing "The Bifröst is
closed" until it is back; stopping `bifrost-web` takes the page off the LAN.

`BIFROST_RUN` in `.env` decides which apps exist: `full` (both, the default),
`api` (the API alone, for the CLI on this Mac) or `web` (the standalone client
alone, no API). `start-pm2.sh` removes the apps the chosen mode does not run.

## One-time setup

```bash
npm install                 # if you haven't
cp .env.example .env        # set HEIMDALL_PIN and anything else
npm run setup               # storage/ folders + migrations
npm run build               # server/dist + client/dist
npm install -g pm2
```

## Start it

```bash
pm2 start ecosystem.config.cjs
pm2 status                  # "bifrost-api" and "bifrost-web" should be online
```

Open `http://bifrost.local:<PORT>` (default 4646), or scan the QR that Bifrost
prints on boot (`pm2 logs bifrost-api --lines 40`).

## Upgrading from the single `bifrost` app

Before PLAN-36, PM2 ran one app called `bifrost`. Re-running
`sh scripts/start-pm2.sh` upgrades it: it deletes `bifrost` **first**, so the
old process can neither hold the API's port nor advertise `bifrost.local`
beside the web host, then starts the two new apps and runs `pm2 save`, so a
reboot brings back the new pair, not the old one.

By hand: `pm2 delete bifrost && pm2 start ecosystem.config.cjs && pm2 save`.

If the web host is ever missing (an upgrade done halfway), the API logs an
`error` ten seconds after it starts: nothing is serving `PORT`, with the
command that fixes it.

## Survive reboots

```bash
pm2 startup                 # prints a command — run it (sets up the launchd hook)
pm2 save                    # snapshot the current process list
```

After this the Mac can reboot and Bifrost comes back on its own — that's
acceptance criterion 1.

## Day to day

| Command | What it does |
|---|---|
| `pm2 restart all` | Restart both (SIGINT → drain → checkpoint → up) |
| `pm2 restart bifrost-api` | Restart the API alone; the page stays up and shows the closed sheet meanwhile |
| `pm2 stop all` | Stop both (state is safe; `pm2 start ecosystem.config.cjs` to resume) |
| `pm2 logs bifrost-api` / `bifrost-web` | Tail one process's stdout/stderr |
| `pm2 monit` | Live CPU/memory |
| `pm2 delete all` | Remove from PM2 (then `pm2 save`) |

After changing code: `npm run build && pm2 restart all`.

## Logs

- **Structured app logs** (what you actually want): pino JSON. The API writes
  `storage/logs/app.N.log` (`current.log` points at the active one, and
  `./bifrost logs` pretty-prints it); the web host writes its own series,
  `storage/logs/app-web.N.log`, with `source: "web"`. The optional
  [observability stack](observability.md) tails both into Grafana.
- **Process logs** (boot banner, uncaught crashes):
  `storage/logs/pm2-api-out.log`, `pm2-api-error.log`, `pm2-web-out.log` and
  `pm2-web-error.log`, also via `pm2 logs`.

## Graceful shutdown

PM2 stops each app with **SIGINT**. The API's shutdown sequence: stop
accepting → drain/abort in-flight uploads → close chokidar + SSE → checkpoint
the SQLite WAL → exit. The web host's: stop advertising `bifrost.local` → end
open event streams cleanly → close. `kill_timeout` in `ecosystem.config.cjs`
(10 s) is the grace window before PM2 escalates to SIGKILL. The restart-
resilience suite (`./bifrost test resilience`) proves state survives even a hard
SIGKILL, so a rare timeout is not data-threatening.
