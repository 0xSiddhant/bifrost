# Running Bifrost with PM2 (production, macOS)

PM2 is the production run mode on the Mac: it keeps Bifrost alive across
crashes and reboots and handles logs. Native macOS (not Docker) is deliberate —
see [`docker-linux.md`](docker-linux.md) for why.

> Prefer zero dependencies? Use [`launchd`](launchd.md) instead — same outcome,
> nothing to `npm install -g`.

**One command:** `sh scripts/start-pm2.sh` does everything below (deps, `.env`
check, setup, build, start under PM2). The steps here are what it runs — do them
by hand when you want more control.

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
pm2 status                  # "bifrost" should be online
```

Open `http://bifrost.local:<PORT>` (default 4646), or scan the QR that Bifrost
prints on boot (`pm2 logs bifrost --lines 40`).

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
| `pm2 restart bifrost` | Graceful restart (SIGINT → drain → checkpoint → up) |
| `pm2 stop bifrost` | Stop (state is safe; `pm2 start` to resume) |
| `pm2 reload bifrost` | Same as restart for a fork-mode app |
| `pm2 logs bifrost` | Tail the process stdout/stderr |
| `pm2 monit` | Live CPU/memory |
| `pm2 delete bifrost` | Remove from PM2 (then `pm2 save`) |

After changing code: `npm run build && pm2 restart bifrost`.

## Logs

- **Structured app logs** (what you actually want): pino JSON at
  `storage/logs/app.log` — `npm run logs` pretty-prints them, and the optional
  [observability stack](observability.md) tails them into Grafana.
- **Process logs** (boot banner, uncaught crashes): `storage/logs/pm2-out.log`
  and `pm2-error.log`, also via `pm2 logs`.

## Graceful shutdown

PM2 stops the app with **SIGINT**, which triggers Bifrost's shutdown sequence:
stop accepting → drain/abort in-flight uploads → close chokidar + SSE →
checkpoint the SQLite WAL → exit. `kill_timeout` in `ecosystem.config.cjs`
(10 s) is the grace window before PM2 escalates to SIGKILL. The restart-
resilience suite (`npm run test:resilience`) proves state survives even a hard
SIGKILL, so a rare timeout is not data-threatening.
