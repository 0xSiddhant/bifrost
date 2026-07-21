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

### Notes

- **Host networking** (`network_mode: host`) is required for mDNS; it means the
  container binds the host's `PORT` directly (no `-p` mapping). Only one process
  can own the port.
- **State** lives in the bind mounts `./storage` and `./themes`. Back them up
  with `npm run backup` on the host, or run the in-app backup (PLAN-10).
- **Permissions:** the container runs as the unprivileged `node` user (uid 1000).
  If the host `./storage` is owned by a different uid, either `chown -R 1000
  storage themes` or adjust the compose `user:`.
- **`.env`** is read at boot from the mount; it is deliberately excluded from the
  image (`.dockerignore`) so secrets never bake into layers.

## Image shape

Multi-stage: a builder installs all deps, runs `npm run build`, and
`npm prune --omit=dev`; the runtime stage is `node:20-bookworm-slim` + `tini`
(init) + `zip`/`unzip` (in-app backup), carrying only built output and
production `node_modules`. A `HEALTHCHECK` polls `/api/health`.

## Verify (owner, on a Linux box/VM)

Acceptance 5 — do this once on real hardware:

1. `docker compose up -d --build` succeeds.
2. From another device on the LAN, `http://<host>.local:4646` loads.
3. Drop a file into `storage/downloads/` on the host → it appears live in the
   Receive page (watcher works under host network).
