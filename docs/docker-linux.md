# Bifrost in Docker (Linux)

On a **Linux host** (a Raspberry Pi, a home server) Bifrost can run entirely in
Docker. On the Mac the API runs natively; see [`docker-mac.md`](docker-mac.md) for
the one piece that may run in Docker there, and [PM2](pm2.md) /
[launchd](launchd.md) for the rest.

## The pieces

Each process has its own image and its own compose file (PLAN-39):

| Piece | Image (`docker/`) | Compose file | What it is |
|---|---|---|---|
| API | `api.Dockerfile` | `compose/api.yml` | REST, SSE, uploads, the database; on the host's loopback `API_PORT` (4647) |
| Web host | `web.Dockerfile` | `compose/web.yml` | the page on `PORT` (4646), the API's paths forwarded, `bifrost.local` |
| Observability | (upstream images) | `compose/observability.yml` | Grafana, Loki, Alloy, Prometheus, Tempo, in the `observability` profile |
| Standalone site | `standalone.Dockerfile` | `compose/standalone.yml` | the browser-only tools site, for a cloud machine ([`standalone.md`](standalone.md)) |

The root `docker-compose.yml` includes the first three, so from the repo root:

```bash
cp .env.example .env                                  # set HEIMDALL_PIN (required) and any limits
docker compose up -d --build                          # the hub: API + web host
docker compose --profile observability up -d --build  # the hub + the Grafana stack
docker compose up -d bifrost-api                      # the API alone (set BIFROST_RUN=api)
docker compose up -d bifrost-web                      # the web host alone (BIFROST_RUN=web: the standalone client)
docker compose logs -f                                # the boot banner / QR
```

Open `http://<host>.local:4646` (the web host advertises it) or
`http://<host-ip>:4646`.

A single file works on its own too. It needs `--env-file .env`, because
Compose reads `${VARS}` from the `.env` beside the file it is given:

```bash
docker compose -f compose/api.yml --env-file .env up -d
docker compose -f compose/observability.yml --env-file .env --profile observability up -d
```

(`sh scripts/observability.sh` runs that last one for you.)

Every file names its project `bifrost`, so mixing them is one project, and
the observability volumes from before PLAN-39 are reused.

## Upgrading

- **From the one-image compose file** (PLAN-36): `docker compose up -d --build`.
  The services keep their names (`bifrost-api`, `bifrost-web`), so they are
  replaced in place with the new images.
- **From the single `bifrost` service** (before PLAN-36): `docker compose up -d
  --build --remove-orphans`. Without `--remove-orphans` the old container keeps
  running beside the new pair, holding the API's port and advertising the name.
- **The observability stack** moved from `docker-compose.observability.yml` to
  `compose/observability.yml`. Its volumes keep their names, so Grafana and
  Loki keep their history.

## Notes

- **Host networking** (`network_mode: host`) is how both hub services run on
  Linux:
  - the web host's mDNS reaches the LAN, and it sees each device's real address;
  - the API's loopback bind is the host's loopback, which is how the web host
    reaches it;
  - there is no `-p` mapping, and only one process can own each port.
- **State** lives in the bind mount `./storage`, shared by both services. Back
  it up with `npm run backup` on the host, or run the in-app backup (PLAN-10).
- **Permissions:** the containers run as the unprivileged `node` user
  (uid 1000). If the host's `storage/` belongs to another uid, run
  `chown -R 1000 storage` (or adjust the compose `user:`). A web host that
  cannot write its logs says so and names that command.
- **`.env`** is read at boot from the mount. It is deliberately excluded from
  every image (`.dockerignore`), so secrets never bake into layers.
- **Caps** (the editors' size limits) are baked into the web image at build
  time and enforced by the API at runtime. `compose/web.yml` reads both from
  the same `.env`, so rebuild the web image (`--build`) after changing one.

## Image shapes

| Image | Build | Runtime |
|---|---|---|
| API | the server workspace only, with `python3`/`make`/`g++` in case `better-sqlite3` has no prebuilt binary; pruned to production dependencies | `node:20-bookworm-slim` + `tini` + `zip`/`unzip` (in-app backup); `HEALTHCHECK` on the API's `/api/health` |
| Web host | both clients (Vite) and the web host (`tsc`); no native toolchain | `node:20-bookworm-slim` with the web host's own production dependencies and the two built clients; no `apt` at all; `HEALTHCHECK` on `/healthz` |
| Standalone | the standalone client only | `nginx-unprivileged`, read-only, no backend |

CI builds all three on every PR and runs `docker compose config` for every
combination above.

## Verify (owner, on a Linux box/VM)

1. `docker compose up -d --build` succeeds, and both services turn healthy.
2. From another device on the LAN, `http://<host>.local:4646` loads, and
   `http://<host-ip>:4647` does not (the API is loopback-only).
3. Drop a file into `storage/downloads/` on the host: it appears live in the
   Receive page (the watcher works under host networking).
4. `docker compose --profile observability up -d` adds the stack, and Grafana
   at `:3000` shows the existing history.
