# PLAN-39 — Docker per process: one image each, composable compose files

## Goal

PLAN-36 split the hub into two processes, but Docker still builds **one** image for both and runs it twice with different commands. This plan gives each process its own image and its own compose file, so any combination can be run on its own or together:

- **Images**, one Dockerfile each under `docker/`:
  - the **API** (`docker/api.Dockerfile`): Node, `better-sqlite3`'s native build, `zip`/`unzip`, the server only;
  - the **web host** (`docker/web.Dockerfile`): Node, the web host and both built clients, no native dependencies;
  - the **standalone site** (`docker/standalone.Dockerfile`): the existing nginx image.
- **Compose files**, one per piece under `compose/`: `api.yml`, `web.yml`, `observability.yml`, `standalone.yml`, plus `web.bridge.yml`, an override for running the web host in Docker on the Mac.
- **The root `docker-compose.yml`** includes the hub pieces, so `docker compose up` runs the hub as today, and `--profile observability` adds the Grafana stack to the same project.

The existing commands (`npm run dev`, `npm start`, PM2, launchd) do not change. On the Mac the API stays native (Finder drops need native file watching), and the web host *may* run in Docker. In that case a small advertiser runs natively beside the API, because a container on the Mac cannot answer for `bifrost.local`. The CLI stays independent of all of this. It only gains a fallback for a hub on the same machine that `bifrost.local` does not reach.

## Gate

PLAN-36 merged. **Exception (owner's instruction, 2026-10-08): built on top of PLAN-36's open PR #88**, which is not merged first. The branch `feat/plan-39-docker-per-process` is cut from `feat/plan-36-separate-ports`, and its PR targets that branch, then is retargeted to `develop` once #88 merges (the PLAN-34-on-#85 pattern). Single PR. It lands before PLAN-37, whose own gate (PLAN-36 merged) is unaffected.

**Merge condition:** `npm test`; the full `npm run test:e2e` (no product path changes, so it must pass unchanged); CI builds all three images; `docker compose config` succeeds for every combination in "Every way of running it in Docker"; a hand-run of the Linux combinations here and of the Mac ones by the owner.

## Verified against the codebase, not assumed

- **Docker today** (PLAN-36's head, `5d9d160`):
  - one `Dockerfile` with stages `builder` (all workspaces, `npm run build`, `npm prune --omit=dev`), `standalone-build` (`npm ci --workspace client --include-workspace-root --ignore-scripts`), `standalone` (nginx-unprivileged) and `runtime`;
  - `runtime` copies `server/dist`, `server/drizzle`, `client/dist`, `client/dist-standalone`, `web/dist` and the whole pruned `node_modules`;
  - its `HEALTHCHECK` polls the API on `API_PORT || PORT + 1`; its `CMD` is the API.
- **Compose today:**
  - `docker-compose.yml`: services `bifrost-api` and `bifrost-web` from one image, `network_mode: host`, `env_file: .env`, `./storage:/app/storage`, `PORT: 4646`;
  - `docker-compose.observability.yml`: loki, alloy (tails `./storage/logs`), prometheus (scrapes `host.docker.internal:4646` via `host-gateway`), tempo and grafana, with named volumes; `scripts/observability.sh` runs it with `-f`;
  - `docker-compose.standalone.yml`: the standalone site on an external proxy network.
- **The root package has no `dependencies`** (only devDependencies), and `web/package.json`'s dependencies are all pure JavaScript (`@fastify/http-proxy`, `@fastify/static`, `bonjour-service`, `dotenv`, `fastify`, `pino`, `pino-roll`, `zod`). So a production install of the web workspace alone needs no compiler.
- **The API needs no client files.** `checkClientBuild` (`server/src/core/client-build.ts`) returns early when `client/dist/bifrost-build.json` is missing. `paths.ts` derives the repo root from `server/dist/core/`, so `/app` keeps the repo layout. (The About section's `CHANGELOG.md` is not in today's image either; unchanged.)
- **The web host's client dirs** are `fromRepoRoot('client', 'dist')` and `…/dist-standalone` (`web/src/main.ts` `clientFor`), so its image keeps the same layout.
- **mDNS:** `web/src/mdns.ts` (`advertiseMdns`) is what the web host runs. `web/src/mdns-dev.ts` already runs it **alone**, for `npm run dev`, gated by `mdnsDecision`.
- **The CLI's address** (`cli/src/core/discover.ts`): `resolveBaseUrl(flag, config)` → `--host`, else the saved host, else `http://bifrost.local:4646` (`source: 'default'`). `client.ts` raises `unreachable(...)` on a transport failure; `doctor` checks reachability with the same message. Nothing in the CLI knows how the server runs.
- **Docker Compose** in this container is v5.3.1. `include:` needs Compose 2.20 or later; Docker Desktop has shipped it since 4.22.

## Scope

**In:**
- the three Dockerfiles;
- the per-piece compose files and the root include;
- the Mac bridge override;
- a native advertiser process and the `MDNS_ADVERTISER` key that chooses who advertises;
- the CLI fallback and `doctor` line;
- CI building every image and validating every combination;
- the launchers starting the advertiser when asked;
- the docs, and moving the old compose files.

**Out:**
- the API in Docker on the Mac (owner's answer: the 2026-07-12 decision stands for the API);
- Docker Swarm and Kubernetes;
- publishing images to a registry;
- the CLI in Docker (it is installed on each machine and never runs in a container);
- any route or client change.

## Decisions & reasoning

### One Dockerfile per image, not targets in one file

The owner asked for separate files, and the images now share almost nothing:
- The API image needs the native toolchain in its builder and `zip` at runtime.
- The web image needs the client build tools (Vite, the client's prebuild scripts) and nothing native.
- The standalone image is nginx.

One file with targets would keep a `builder` stage that installs every workspace for both, which is what made the image heavy. Separate files also let CI and compose build each image alone. The cost is a few repeated lines: each file has its own `npm ci` and its manifest `COPY` list. They are kept short and each one says what it copies.

### What each image contains

- **API:**
  - builder: `npm ci --workspace server --include-workspace-root`, then `npm run build -w server` and `npm prune --omit=dev`;
  - runtime: `node:20-bookworm-slim` with `tini`, `zip`, `unzip`, `server/dist`, `server/drizzle`, the manifests and the pruned `node_modules`;
  - `HEALTHCHECK` on `API_PORT/api/health`; `CMD` the API with `--import ./server/dist/otel.js`.
- **Web:**
  - a client stage builds both clients exactly as today's `standalone-build` stage does, with the same cap build args (both builds, since `web` mode serves the standalone one);
  - a web stage runs `tsc` for `web/`;
  - runtime: `node:20-bookworm-slim` with `tini`, `web/dist`, `client/dist`, `client/dist-standalone`, and `npm ci --workspace web --omit=dev`'s `node_modules`;
  - `HEALTHCHECK` on `PORT/healthz`; `CMD` the web host.
- **Standalone:** today's two stages, moved unchanged.

Both node images keep the non-root `node` user and `/app` as the repo root.

⚠️ **Cap drift across images.** Today one image carries both the client build and the server, and the boot check compares them. Split, the API image has no `bifrost-build.json`, so the check is silent. In compose the caps come from one place, a `x-bifrost-caps` build-args anchor in `compose/web.yml` read from the same `.env` the API uses at runtime, so they cannot differ unless someone overrides one side by hand. The docs say so. A cross-process check (the API asking the web host) would need a new route, and this plan adds none.

### Compose: a file per piece, the root includes the hub

- `compose/api.yml` is `bifrost-api` and `compose/web.yml` is `bifrost-web`, the same service names as PLAN-36, so an existing `up` replaces them in place.
- `compose/observability.yml` is the stack, unchanged except that every service carries `profiles: [observability]`.
- `compose/standalone.yml` is the cloud site, unchanged.
- The root `docker-compose.yml` is `include:` of api, web and observability. Results:
  - `docker compose up -d` runs the hub (API + web; the observability services are profiled, so they stay off);
  - `docker compose --profile observability up -d` runs the hub and the stack in one project;
  - `docker compose up -d bifrost-api` runs one piece;
  - `docker compose -f compose/observability.yml --profile observability up -d` runs the stack alone (what `scripts/observability.sh` runs).

The standalone site is not included: it runs on a different machine, on an external network the hub does not have.

⚠️ **Two traps in moving the files:**
- **Paths.** A relative path in an included or `-f` file resolves against that file's directory. Every `./storage` and `./observability/...` becomes `../storage` and `../observability/...`, and `env_file` becomes `../.env`.
- **The project name.** Without a `name:`, `-f compose/observability.yml` makes the project `compose`, so its named volumes become `compose_loki-data` and Grafana and Loki silently start empty. Every file sets `name: bifrost`, which is the project name the old root files got from the directory, so existing volumes are reused.

### The web host in Docker on the Mac: a bridge override, and a native advertiser

On Linux both services use `network_mode: host`, as today: the web host advertises, sees real client addresses, and reaches the API on loopback.

On the Mac (owner's answer: web host only), `compose/web.bridge.yml` overrides `bifrost-web` with:
- `network_mode: bridge`;
- `ports: ['4646:4646']`;
- `extra_hosts: ['host.docker.internal:host-gateway']`;
- `API_HOST=host.docker.internal`.

The API runs natively with `BIFROST_RUN=api` under PM2 or launchd.

**Who answers for `bifrost.local`.** Publishing a port does not carry mDNS:
- mDNS is multicast to 224.0.0.251:5353, and Docker's port publishing forwards unicast only;
- inside Docker Desktop's VM, a responder would announce the container's private address.

So the host advertises: a new key `MDNS_ADVERTISER` = `web` (default: the web host advertises, as today) | `host` (a separate native process advertises, and the web host does not) | `off`. `web/src/advertise.ts` generalises `mdns-dev.ts` into a production entry (`web/dist/advertise.js`), and `mdns-dev.ts` becomes a thin call into it. When `MDNS_ADVERTISER=host`, `npm start`, PM2 and launchd add a third process, `bifrost-mdns`. Both sides read the same `.env`, so the container (which reads `host`) does not advertise and the Mac's advertiser does. This reuses the responder PLAN-36 already hardened (error guard, network-change rebuild) instead of shelling out to `dns-sd -P`, which pins one IP and would need its own re-registration on a DHCP change.

⚠️ **Mandated spike on the owner's Mac** (Docker Desktop cannot run in this container). It has two questions, and the plan says what each answer changes:
1. **Does a container reach a Mac service bound to 127.0.0.1 through `host.docker.internal`, and from which source address?**
   - If it arrives as loopback: nothing changes (`API_HOST=127.0.0.1` stays, and `trustProxy: 'loopback'` trusts the web host).
   - If it arrives from another address: `API_HOST` must listen on the address Docker uses, and a new `API_TRUSTED_PROXY` key names it for `trustProxy`. It stays off the LAN only if that address is not a LAN interface, which the spike also records.
   - If it is not reachable at all: the Mac combination is dropped from the docs, and Linux keeps everything.
2. **Does the web host see each LAN device's own address through Docker Desktop's published port?** Docker Desktop's port forwarding has historically replaced the client address with its own gateway.
   - If it is replaced: every device behind the containerised web host looks like one client to the login throttle, the upload and Brotli rate limits, presence and upload attribution. One device's wrong PINs would then lock out everyone. In that case the docs mark the Mac Docker web host as a convenience mode with that cost, and recommend the native web host, which keeps real addresses.
   - Nothing in code can recover an address the forwarder threw away.

### The CLI: a same-machine fallback, no Docker awareness

The CLI cannot tell a container from a native process, and should not try: either way the web host publishes the same port. What it can fix is the common local failure: `bifrost.local` does not resolve (Linux without `nss-mdns`, a fresh VM, `MDNS_ADVERTISER=off`) while the hub runs on this machine.

When, and only when, the address came from the default (`source: 'default'`, never a `--host` or a saved host), a transport failure retries `http://127.0.0.1:4646` (the web host), then `http://127.0.0.1:4647` (`BIFROST_RUN=api`). The first that answers `/api/health` is used for the rest of that command.
- `doctor` reports which address answered and suggests `bifrost config set-host <it>` to skip the probe next time.
- When none answers, the error still names the original address with the existing remediation, plus the two it also tried.
- Every other command and every explicit address behave exactly as before.

### The old root compose files

`docker-compose.observability.yml` and `docker-compose.standalone.yml` move under `compose/`. Nothing points at their old paths except `scripts/observability.sh`, the docs and CI, all updated here. The root `docker-compose.yml` stays where it is, so `docker compose up` keeps working from the repo root. The root `Dockerfile` is removed: every image now has its own file, and a root `Dockerfile` that built only one of them would be misleading.

## API contracts

None. No route is added, changed or removed; `server/openapi.json` stays unchanged.

## Task checklist

- [x] `docker/api.Dockerfile`, `docker/web.Dockerfile`, `docker/standalone.Dockerfile`; remove the root `Dockerfile`; `.dockerignore` checked for the new layout
- [x] `compose/api.yml`, `compose/web.yml` (caps build-args anchor), `compose/web.bridge.yml`, `compose/observability.yml` (profiled), `compose/standalone.yml`; root `docker-compose.yml` as `include:`; `name: bifrost` everywhere; paths rebased to `../`
- [x] `MDNS_ADVERTISER` (`web` | `host` | `off`) in both config loaders, `.env.example`, `mdnsDecision`; `web/src/advertise.ts` + `web/dist/advertise.js`; `mdns-dev.ts` on top of it
- [x] `scripts/start.ts`, `ecosystem.config.cjs`, `start-pm2.sh`, `start-launchd.sh`: the `bifrost-mdns` process when `MDNS_ADVERTISER=host`, removed again when it is not
- [x] CLI: the same-machine fallback in `client.ts` (default address only), `doctor`'s line, unit tests
- [x] `scripts/observability.sh` → `compose/observability.yml`
- [x] CI: build the three images; `docker compose config` for every combination; the standalone smoke against the new file
- [x] Docs: `docs/docker-linux.md` (rewritten around the combinations), a new `docs/docker-mac.md` (the bridge override, the advertiser, the spike's results), `docs/observability.md`, `docs/standalone.md`, `README.md`, `architecture.md`, `project-structure.md`, `tech-stack.md`, the verify skill's Docker step
- [ ] Hand-run on Linux here: hub, hub + observability, each piece alone, standalone; the owner runs the Mac spike and the Mac combination
- [x] `decisions.md`, `progress.md`; archive this file into `completed/` in the PR

## Acceptance criteria

1. Three Dockerfiles each build on their own. The web image has no compiler toolchain and is smaller than PLAN-36's combined image.
2. `docker compose up -d` from the repo root runs the hub exactly as PLAN-36's compose file did: same service names, same ports, same `storage/`.
3. `docker compose --profile observability up -d` runs the hub and the Grafana stack in one project, reusing the existing Grafana/Loki volumes.
4. Each piece runs alone from its own file, and `scripts/observability.sh` keeps working.
5. On the Mac, the native API plus `compose/web.yml` + `compose/web.bridge.yml` serves `bifrost.local:4646`, with `bifrost.local` answered by the native advertiser, within whatever the spike establishes.
6. `MDNS_ADVERTISER` defaults to `web`, so with no new key set every PLAN-36 behaviour is unchanged. `host` starts exactly one advertiser and the web host advertises nothing.
7. The CLI with no saved host reaches a hub on the same machine when `bifrost.local` does not resolve; `doctor` names the address that answered. `--host` and a saved host never fall back.
8. No route, client or e2e behaviour changes; `npm test` and `npm run test:e2e` pass unchanged.

## Test checklist

**Unit**
- [x] CLI fallback: default address fails then `127.0.0.1:4646` answers; both fail then `:4647` answers; none answers (the error names all three); an explicit `--host` and a saved host never fall back
- [x] `mdnsDecision` with `MDNS_ADVERTISER` web/host/off; the advertiser entry honours the same decision
- [x] `processesFor` and the launchers' process set include `bifrost-mdns` only for `host`

**CI**
- [x] The three images build; `docker compose config -q` for the root file, `--profile observability`, each piece alone, and `web.yml` + `web.bridge.yml`

**Manual**
- [ ] Linux (here): the hub, hub + observability, the API alone, the web host alone, and the standalone site, each up and healthy; volumes reused across the move
- [ ] Owner's Mac: the spike's two questions, then the native API + Docker web host + native advertiser, with `dns-sd -B _http._tcp` showing one `bifrost`
