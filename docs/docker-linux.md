# Bifrost in Docker (Linux target)

**The Mac does not run Bifrost in Docker.** Use [PM2](pm2.md) or
[launchd](launchd.md) there. This image exists for two reasons:

1. The natural migration to a **Raspberry Pi / Linux home server**.
2. **Executable documentation** of the runtime environment — CI builds it on
   every PR so it can't silently rot.

## Why not Docker on macOS

Three core behaviours break inside Docker Desktop's Linux VM:

- **mDNS** multicast can't cross the VM boundary, so `bifrost.local` never
  resolves for other devices. (`network_mode: host` is a no-op on Docker
  Desktop — it only truly shares the host network on native Linux.)
- **chokidar/FSEvents** degrade to polling on bind mounts — the live-downloads
  watch becomes slow and CPU-hungry.
- The whole point is dropping files into **Finder-native folders**; a container
  volume is not that.

On a real Linux host with `--network host`, mDNS and the watcher work normally.

## Run it on Linux

```bash
cp .env.example .env          # set HEIMDALL_PIN (required) and any limits
docker compose up -d --build
docker compose logs -f        # watch the boot banner / QR
```

Open `http://<host>.local:4646` (Avahi advertises it) or `http://<host-ip>:4646`.

### Two services (PLAN-36)

`docker-compose.yml` runs one image as two services, the same two processes as
on the Mac:

| Service | What it is | Listens on |
|---|---|---|
| `bifrost-api` | the API server | `127.0.0.1:API_PORT` (default 4647), the host's loopback |
| `bifrost-web` | the web host: the client, the API's paths forwarded, `bifrost.local` | `PORT` (4646) on the LAN |

`docker compose up -d` starts both. For one alone, name it, with the matching
`BIFROST_RUN` in `.env`: `docker compose up -d bifrost-api` (`api`) or
`docker compose up -d bifrost-web` (`web`, the standalone client, no API).
Restarting `bifrost-api` alone (`docker compose restart bifrost-api`) leaves the
page up, showing "The Bifröst is closed" until it is back.

**Upgrading from the single `bifrost` service:** `docker compose up -d
--build --remove-orphans`. Without `--remove-orphans` the old container keeps
running beside the new pair, holding the API's port and advertising the name.

### Notes

- **Host networking** (`network_mode: host`) is required for mDNS; it means the
  containers bind the host's `PORT` and `API_PORT` directly (no `-p` mapping),
  and the API's loopback bind is the host's loopback, which is how the web host
  reaches it. Only one process can own each port.
- **State** lives in the bind mount `./storage`, shared by both services. Back
  it up with `npm run backup` on the host, or run the in-app backup (PLAN-10).
- **Permissions:** the container runs as the unprivileged `node` user (uid 1000).
  If the host `./storage` is owned by a different uid, either `chown -R 1000
  storage` or adjust the compose `user:`.
- **`.env`** is read at boot from the mount; it is deliberately excluded from the
  image (`.dockerignore`) so secrets never bake into layers.

## Image shape

Multi-stage: a builder installs all deps, runs `npm run build`, and
`npm prune --omit=dev`; the runtime stage is `node:20-bookworm-slim` + `tini`
(init) + `zip`/`unzip` (in-app backup), carrying only built output and
production `node_modules`. The image's `HEALTHCHECK` polls the API's
`/api/health` on `API_PORT`; the compose file gives `bifrost-web` its own,
polling `/healthz` on `PORT`.

## Verify (owner, on a Linux box/VM)

Acceptance 5 — do this once on real hardware:

1. `docker compose up -d --build` succeeds.
2. From another device on the LAN, `http://<host>.local:4646` loads, and
   `http://<host-ip>:4647` does not (the API is loopback-only).
3. Drop a file into `storage/downloads/` on the host → it appears live in the
   Receive page (watcher works under host network).
