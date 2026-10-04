# PLAN-36 — Separate ports: web host and API server

## Goal

The hub's client and its API run in one process on one port: `PORT` (4646) serves `client/dist`, every API path and the live-updates stream. This plan splits them into **separate processes on separate ports**:

- a small **web host** (a new `web/` workspace) serves the hub client on `PORT`, the address everyone already opens (`bifrost.local:4646`), and forwards the API paths to the API server, the same way Vite already does in development;
- the **API server** moves to its own `API_PORT`, bound to loopback.

Every way of running Bifrost is updated so it starts and stops both as smoothly as today: `npm run dev`, `npm start`, PM2, launchd, Docker, setup, the backup agent, the observability stack, and the test and load harnesses. Bookmarks, QR codes, home-screen icons, mDNS and the installed CLI all keep working unchanged. Split out of PLAN-35 at the owner's request, because it is a task of its own. The literal name is the name.

## Gate

PLAN-35 merged. Single PR, no parts. **Linear sequence: 32 → 33 → 34 → 35 → 36.**

**Merge condition:**
- `npm test`;
- the full `npm run test:e2e` with every suite **going through the web host**;
- `server/openapi.json` unchanged;
- a `npm run test:load` comparison before and after this plan (see "Streams, SSE and uploads pass through unbuffered");
- a hand-run of every start path in "Every way of running Bifrost".

## Verified against the codebase, not assumed

- **Ports today:**
  - one process listens on `PORT` (required, `.env.example` 4646) at `0.0.0.0` (`app.ts`), serving `client/dist` through `@fastify/static` with an SPA fallback, plus every API path;
  - `npm start` = `cli-sync` + `node --import server/dist/otel.js server/dist/bootstrap.js`;
  - `ecosystem.config.cjs` runs one PM2 app; `scripts/start-launchd.sh` writes one plist running `bootstrap.js`; `start-pm2.sh` and `start-launchd.sh` both print `http://<name>.local:$PORT`;
  - `Dockerfile` `EXPOSE 4646`, `HEALTHCHECK` on `$PORT/api/health`, one `CMD`; `docker-compose.yml` sets `PORT: 4646`;
  - `observability/prometheus/prometheus.yml` scrapes `host.docker.internal:4646` (`/metrics`);
  - `scripts/backup-agent.sh` checks `http://127.0.0.1:$PORT/api/health` before backing up.
- **Dev already splits ports:** `client/vite.config.ts` serves on Vite's default port and proxies `/api`, `/runestone/api`, `/edda/api`, `/groot/api`, `/atlas/api` and `/go` to `PORT`. `npm run dev` runs both through `concurrently`, a root **devDependency**, so it is not available to a production `npm start`.
- **Who uses the port:**
  - the join URLs and boot QR (`qr-tool`'s `serverUrls`) and mDNS (`advertiseMdns(name, config.port)`) both use `PORT`;
  - the CLI defaults to `http://bifrost.local:4646` (`cli/src/core/discover.ts`) and uses that **one** base URL both for API calls and for browser pages it opens (`preview` → `/edda/preview/…`, `/saga…`), and as the allowed origin of its one-shot `localServe`;
  - an installed CLI can be older than the server.
- **mDNS is a name server, not just an advertisement:** `server/src/core/mdns/index.ts`'s `advertiseMdns(name, port)` publishes the `_http._tcp` service **and** sets `host: '<name>.local'`, which makes the process answer A/AAAA queries for `bifrost.local` (the code's own comment: "the browser resolves the hostname, not the service"). So `bifrost.local` resolves **only while the process running the responder is alive**. The module also holds the hard-won robustness work: a `warn` instead of bonjour-service's default `throw` on send errors, guards on the responder socket, and a 5 s network-change watcher that rebuilds the responder when an interface comes back on the same address. It is started from `app.ts` (`main`, local profile) with `config.port`, and its `lanIPv4Addresses()` helper is also used by `qr-tool`'s `serverUrls` and the boot log lines. Tests: `core/mdns/mdns.test.ts`. Dependency: `bonjour-service`.
- **Client IPs:** five places read `request.ip`: Heimdall's login throttle, presence/SSE, upload attribution, client-log relays, and Nimbus's device fallback. Fastify has no `trustProxy` set, so behind a proxy every request would appear to come from the proxy.
- **PLAN-35 is in place by then:** the hub client already maps a network-level failure to `HubUnreachableError` and shows "The Bifröst is closed" with "Try again", which is what a proxied `502` from a stopped API server will reach.

## Scope

**In:**
- a new `web/` workspace: the hub's web host on `PORT`, serving `client/dist` and proxying API paths to `API_PORT`;
- the API server on `API_PORT`, loopback by default, trusting the proxy's forwarded client IP;
- every run path updated: dev, `npm start`, PM2, launchd, Docker/compose, setup, the backup agent, Prometheus, the `verify`/`live-verify` skills, the e2e and load harnesses;
- **three run modes** behind one switch (`BIFROST_RUN=full|api|web`) and one bind setting for the web host (`WEB_HOST`), so each service runs alone or together on this machine, on the LAN, and (standalone only) on the VPS. With nothing set, the behaviour is exactly the default hub.

**Out:**
- Any route change: the API surface and `server/openapi.json` are untouched.
- The browser calling the API port directly (cross-origin): rejected below in favour of the same-origin proxy.
- Running the web host on a different machine than the API: possible later by pointing it at a non-loopback `API_HOST`, but not set up or tested here.
- The standalone **container** on the VPS (PLAN-35): unchanged.
- The hub API on a public VPS: still explicitly rejected (PLAN-99), since `file-transfer` and the shared-PIN admin are LAN-trust features.
- A web host forwarding to an API on another machine, or an API reachable on the LAN without the web host: not needed for any of the owner's scenarios, so not built. Each is a later, separate decision.

## Decisions & reasoning

### Separate processes and ports, joined by a same-origin proxy

This plan puts the hub's client and its API in **separate processes on separate ports**:
- **web host** (new `web/` workspace, `@bifrost/web`, Fastify + `@fastify/static` + `@fastify/http-proxy`): serves `client/dist` with the SPA fallback on `PORT`. It forwards these paths to the API server: `/api`, `/runestone/api`, `/edda/api`, `/groot/api`, `/atlas/api`, `/go` and `/metrics`. That is the exact list `vite.config.ts` already proxies in development, plus `/metrics`.
- **API server**: the existing server, no longer serving `client/dist`, listening on `API_PORT`.

The web host imports nothing from `server/src`, enforced by the same lint rule as `e2e/`. It is about 100 lines: static files, the proxy, health, logging and graceful shutdown.

**Rejected: the browser calling `API_PORT` directly.** That would need:
- a configurable API origin in the client;
- a CORS allowlist on the server;
- `credentials: 'include'` on every request and on the SSE connection, for the Heimdall cookie;
- every "API"/"Copy curl"/raw-document/`/go` link and the join QR rebuilt from a second origin;
- installed CLIs repointed.

That is a large surface for the same result. The proxy keeps the browser on one origin, so none of it is needed. It also makes production the same shape as development, which has run this way since PLAN-00.

### `PORT` keeps its meaning; the API moves to `API_PORT`, loopback-only by default

`PORT` stays the address people and devices open, so the owner's `.env` does not change: it is now the web host's port. Two new keys:
- `API_PORT`: default `PORT + 1`, so 4647;
- `API_HOST`: default `127.0.0.1`.

Binding the API to loopback means the only way in from the network is through the web host. There is one door, the rate limits and logs see every request in one place, and nothing can bypass the proxy.

Everything that names the public address stays on `PORT` and is therefore unchanged in value:
- the `bifrost.local` name and its mDNS advertisement (now answered by the web host, see the next decision), the join URLs and the boot QR;
- the CLI's default `bifrost.local:4646`. API calls go through the proxy, and browser pages are the web host's, which is exactly what `preview` and `localServe` already assume.

**An installed, older CLI therefore keeps working with no change.** `npm run setup`'s drift check lists the two new keys. Both have defaults, so nothing is required.

### ⚠️ The process that answers `PORT` also answers for `bifrost.local`

The mDNS responder does not only advertise; it **is** the name server for `bifrost.local`. If it stayed in the API server, the name would die with the API:
- with the API down and the web host up, no device could find `bifrost.local`, so the "The Bifröst is closed" page the web host is ready to serve would be unreachable by name, only by typing an IP;
- every API restart (a deploy, a crash) would briefly take the name away while the site itself never went down.

The name and the port must live and die together. So **the responder moves into the web host:**

- **What moves:** `advertiseMdns`, `watchNetworkChanges`, `mdnsErrorHandler`, `attachResponderGuards` and their tests move from `server/src/core/mdns/` to `web/src/mdns.ts`, with `bonjour-service` moving to `web/package.json`. It is a move, not a rewrite: every robustness fix (warn instead of crash on a lost interface, the socket guards, the same-address rebuild) comes along unchanged, and its tests come along with it.
- **What stays:** the server keeps only `lanIPv4Addresses()` (five lines, used by `qr-tool`'s join URLs and the boot log), in `server/src/core/net.ts`. The web host has its own copy. That is the deliberate small duplication this project accepts across workspaces, which may not import each other.
- **What it advertises:** the web host reads `MDNS_NAME`, `PORT` and `DEPLOY_PROFILE` from the shared `.env` and advertises only for the `local` profile, exactly as `main()` does today. It starts after its own listener is up and unpublishes (sending a goodbye) during shutdown, before closing.
- **Development:** `npm run dev` has no web host (Vite serves the client on `PORT`), so the dev script runs a third, advertiser-only process, `web/src/mdns-dev.ts`, beside Vite and the API. `bifrost.local` keeps working in development as it does today.
- **One advertiser at a time:** two responders publishing `bifrost` would conflict (bonjour-service probes and errors). The upgrade path below stops the old single process **before** the web host starts, and the web host logs `error` if probing reports the name already taken, naming the likely cause (an old Bifrost process still running).
- **Docker on Linux:** the web host's compose service keeps `network_mode: host`, which multicast needs. The API service no longer needs host networking for mDNS, only for its loopback bind.

### ⚠️ The API must still see the real client IP

Behind a proxy, `request.ip` becomes `127.0.0.1` for every device. Then:
- the Heimdall login throttle would lock out the whole household after one person's wrong PINs;
- presence, upload attribution and client-log relays would all name the proxy;
- Nimbus would treat every device as one.

So:
- the web host sets `X-Forwarded-For` (`@fastify/http-proxy`'s default; the spike confirms it, and the web host sets it explicitly if not);
- the API server sets `trustProxy` to **loopback only**, so a forwarded header is believed only when the request really came from the local web host. A client on the LAN cannot spoof its IP, because it cannot reach the loopback-bound API at all.

A black-box test logs in with wrong PINs from two different forwarded addresses and checks that only one gets throttled.

### Streams, SSE and uploads pass through unbuffered (spiked first)

The proxy sits in front of every byte the hub moves:
- 2 GB uploads, whose flat memory is promised by `architecture.md`;
- range downloads and folder `.zip` streams with no `content-length`;
- Brotli and Nimbus streams;
- long-lived SSE connections.

**A spike runs before any wiring.** In a scratch project with `@fastify/http-proxy` it checks:
1. SSE events arrive immediately, with no buffering and no idle timeout cutting a stream between heartbeats;
2. a 1 GB upload passes with the proxy's RSS flat;
3. `Range` → `206`/`416` and `Content-Range` pass through;
4. a streamed zip without `content-length` arrives whole;
5. `X-Forwarded-For` is set;
6. closing the proxy mid-upload closes the upstream promptly.

If any of these fails with that library, the fallback is a hand-written proxy on `node:http` `pipeline()` for that path class (the PLAN-25 precedent of owning a stream end to end), and the spike result says which. The proxy's own body limit is off; the API server's existing caps decide.

PLAN-34's `npm run test:load` then measures the cost of the extra hop: `load` and `fanout` before and after this plan, same machine. The report records the throughput and p99 difference, and the upload RSS high-water mark must stay within the flat-memory promise. The extra hop is local loopback, so it should be small. The number decides, not the assumption.

### Every way of running Bifrost starts both, as smoothly as today

| Path | Today | After PLAN-36 |
|---|---|---|
| `npm run dev` | Vite (own port) + API on `PORT` (API advertises mDNS) | Vite on `PORT` + API on `API_PORT` + the advertiser-only `mdns-dev` process: dev and production share one URL and one name. `vite.config.ts` proxies to `API_PORT` |
| `npm start` | `cli-sync` + `node … bootstrap.js` | `cli-sync` + `scripts/start.ts`, which starts both children, prefixes their output, forwards `SIGINT`/`SIGTERM` to both, and exits non-zero if either dies (no `concurrently`, which is a devDependency) |
| PM2 (`ecosystem.config.cjs`, `start-pm2.sh`) | one app | two apps, `bifrost-api` and `bifrost-web`, each with its own logs and `autorestart`; the script prints the same `open:` URL |
| launchd (`start-launchd.sh`) | one plist | two plists, `…bifrost.api` and `…bifrost.web`, both `KeepAlive`; re-running the script replaces the old single plist |
| Docker (`Dockerfile`, compose) | one `CMD`, `EXPOSE 4646` | one image, two commands; compose runs two services on host networking; `EXPOSE` `PORT` only; `HEALTHCHECK` per service |
| `npm run setup` | — | reports both ports; drift check knows the new keys |
| Backup agent | `127.0.0.1:$PORT/api/health` | `127.0.0.1:$API_PORT/api/health`: the API's own health, so a stopped web host does not skip backups. When `.env` has no `API_PORT`, the script derives `PORT + 1` exactly as the server's config does, so both agree on the default |
| Prometheus | `host.docker.internal:4646/metrics` | unchanged: `/metrics` is proxied on `PORT` |
| CLI | `bifrost.local:4646` | unchanged |
| `test:resilience` | spawns `server/dist/app.js` on a random port | spawns the API only (it tests SQLite durability) on a random `API_PORT` |
| e2e harness, load harness | spawn one process | `e2e/support/server.ts` spawns both on free ports; every suite goes through the web host. The load harness also gets an `--direct` flag to measure the API without the proxy |
| `verify` / `live-verify` skills | one server, one port | start both via `npm start`; restart smoke on both; the documented URL unchanged |

### Run modes: one switch, defaults unchanged, nothing new to learn for the normal case

The owner wants every service usable **alone and together**, on this machine, on the LAN and on the VPS, without making the system complicated. So there are exactly two new settings, and **with neither set, everything behaves as the default hub**:

- **`BIFROST_RUN`** = `full` (default) | `api` | `web`: which processes start;
- **`WEB_HOST`** = `0.0.0.0` (default) | `127.0.0.1`: where the web host listens.

| Mode | Starts | Serves | `bifrost.local` (mDNS) |
|---|---|---|---|
| `full` (default) | web host + API | the **hub** client on `PORT`, forwarding API paths to `API_PORT` | advertised, when `WEB_HOST` is not loopback |
| `api` | API only, on `API_HOST:API_PORT` (loopback) | the API and its docs (PLAN-38); no client | not advertised (no web host, nothing for a name to point at) |
| `web` | web host only | the **standalone** client on `PORT`, with no forwarding at all; it is the same client the VPS container serves | advertised, when `WEB_HOST` is not loopback |

Every place that starts Bifrost honours the same switch, so there is one idea and not one per launcher:
- `scripts/start.ts` starts the processes for the mode;
- PM2's `ecosystem.config.cjs` starts only the matching apps;
- `start-launchd.sh` installs only the matching plists, and removes plists of a previous mode;
- compose uses profiles (`api`, `web`).

Two rules keep the modes from surprising anyone:
- **`web` always serves the standalone build.** "Client without a server" means the tools-only site that never calls one, not a hub client whose every feature ends in "The Bifröst is closed". So in `web` mode the web host forwards nothing, and `/api/…`, `/go/…` and `/<kind>/api/…` fall to the app, which shows the sheet exactly as the VPS container does. Its fallback, cache and header rules are the **same** as PLAN-35's committed `nginx.conf`, held by the parity test PLAN-35 already has, so the standalone client behaves identically locally, on the LAN and on the VPS.
- **`npm run build` builds both clients** (`client/dist` and `client/dist-standalone`), so every mode works after one build, with no "forgot to build the other one" step. Vite builds them in sequence; the cost is seconds.

The checks and warnings follow the mode, so no mode logs a false alarm:
- the API's "nothing is serving `PORT`" error (upgrade safety) runs only in `full` mode;
- in `api` mode, the boot log prints the docs URL and the CLI hint: "`bifrost --host 127.0.0.1:4647`" (the CLI's default `bifrost.local:4646` has nobody behind it in this mode);
- with `WEB_HOST=127.0.0.1`, mDNS is switched off with an `info` line, because advertising a name other devices cannot reach would only mislead them;
- a mode the files cannot serve (for example `web` with no `client/dist-standalone`) refuses to start, with the one command that fixes it.
- the backup agent reads `BIFROST_RUN` too: in `web` mode there is no hub data in use, so it skips with that reason ("web-only mode: nothing to back up") instead of a daily "server not running";
- Prometheus scrapes `/metrics` through the web host on `PORT` in `full` mode, as today. In `api` mode `/metrics` is on loopback `API_PORT` only, which `docs/observability.md` notes; `web` mode has no metrics endpoint, by design.

**Where each service can run after this plan:**

| | This machine only (`127.0.0.1`) | LAN (`bifrost.local`) | VPS (Docker, public) |
|---|---|---|---|
| Hub (client + API) | `full`, `WEB_HOST=127.0.0.1` | `full` (default) | rejected (LAN-trust features) |
| API alone | `api` | through `full` | rejected |
| Standalone client alone | `web`, `WEB_HOST=127.0.0.1` | `web` | PLAN-35's container |

### ⚠️ Upgrading an existing install must not leave the hub dark

The owner's Mac already runs Bifrost under launchd or PM2 with **one** definition that starts `bootstrap.js`. After this plan, that same old definition would start only the API, now on loopback `API_PORT`, and nothing would answer `PORT`. Every device would lose the hub until someone noticed. So:

- **launchd:** re-running `sh scripts/start-launchd.sh` (it takes no subcommands today) detects the old single plist, unloads and removes it, then installs the two new ones.
- **PM2:** `start-pm2.sh` deletes an old `bifrost` app before starting `bifrost-api` and `bifrost-web`, so the old process cannot hold `API_PORT` and collide with the new one.
- **Order matters for the name:** both scripts stop the old process **before** starting the web host, so the old single process and the new responder never both publish `bifrost` at once.
- **A forgotten step is loud:** the API server, at boot, checks whether anything answers on `PORT` after a short grace period. If nothing does, it logs an `error`: "nothing is serving PORT 4646 — the web host is not running; re-run `sh scripts/start-pm2.sh` or `sh scripts/start-launchd.sh`".
- **Docker:** a compose file from before this plan keeps running its one service, which is now the API only, so the upgrade note says to pull the new `docker-compose.yml`.
- **Release notes:** the `CHANGELOG` entry and `README.md` carry a short "upgrading from one process to two" section.

The upgrade is tested by hand on the owner's Mac, from the current single-process install to the new pair, under both PM2 and launchd. This is the step most likely to go wrong on a real machine and the one no CI job can run.

Shutdown order: the web host stops accepting first and closes its upstream connections, then the API drains as today (`forceCloseConnections`). `scripts/start.ts` and both PM2 and launchd definitions follow that order.

The web host logs through pino to the same `storage/logs` archive with `source: 'web'`, so Grafana sees both processes. It logs:
- start, stop and the ports it is using;
- upstream unreachable;
- a request aborted mid-stream.

**When the API server is down,** the web host answers proxied API paths with a JSON `502 { error: 'HUB_UNAVAILABLE' }` and **still serves the client**.

⚠️ **That 502 does not trigger PLAN-35's sheet by itself.** PLAN-35 maps only network-level failures (a thrown `TypeError` or timeout) to `HubUnreachableError`, and deliberately treats any HTTP status as `ApiError`, because a 4xx/5xx means the server answered. Behind the web host, the API being down now arrives as an HTTP 502. So this plan extends `core/api.ts`: an `ApiError` with code `HUB_UNAVAILABLE` is mapped to `HubUnreachableError`, and the sheet shows with "Try again" as before. A unit test pins it, and the e2e journey stops only the API to prove it. The SSE stream gets a 502 the same way, so `bifrostEvents.onStatus` reports `closed`/`connecting` and the sheet's auto-close on `'open'` still works.

`/go/<slug>` is followed by people, not by the client, so a JSON 502 would land raw in their browser. For `/go/*` the web host answers a small static HTML "The Bifröst is closed" page (same copy, inline theme-neutral styles) with status 503 and `Retry-After`.

**Offline mode changes meaning, for the better.** PLAN-22 warm-loads pages so they still open when "the server" is gone. Now:
- **API down:** the web host still serves every chunk, so pages load and only API actions show the sheet;
- **web host down:** warm-load matters, exactly as before.

PLAN-32's journey 17 ("a warmed page still opens after the server is stopped") is rewritten to stop the **web host**, and a new step stops only the API.

## API contracts

**No route changes.** New env keys `API_PORT` (default `PORT + 1`), `API_HOST` (default `127.0.0.1`), `BIFROST_RUN` (default `full`) and `WEB_HOST` (default `0.0.0.0`). With none of them set, the hub behaves exactly as described above. `PORT` keeps its meaning as the address people open, now served by the web host. A proxied path returns `502 HUB_UNAVAILABLE` from the web host while the API server is down.

## Task checklist

- [ ] Spike first (scratch project, never committed): the six pass-through checks in "Streams, SSE and uploads pass through unbuffered"; record the result and the chosen proxy per path class in `decisions.md`
- [ ] `web/` workspace (`@bifrost/web`): static `client/dist` + SPA fallback, proxy for the seven path roots, `X-Forwarded-For`, no body limit, `502 HUB_UNAVAILABLE` (an HTML 503 page for `/go/*`), `/healthz` (added to `RESERVED_ROOTS` and its test, per the routing rule), pino `source: 'web'`, graceful shutdown; lint rule banning `server/src`; `tech-stack.md` rows
- [ ] Server: stop serving `client/dist`; listen on `API_HOST:API_PORT`; `trustProxy` loopback-only; config keys `API_PORT` / `API_HOST` (zod; `API_PORT ≠ PORT`); `serverUrls` and the boot QR still on `PORT`; the mDNS responder **removed** from the API server (`app.ts` no longer calls `advertiseMdns`), with `lanIPv4Addresses()` kept in `core/net.ts`
- [ ] Move the mDNS responder to `web/src/mdns.ts` (+ tests, `bonjour-service` dependency); the web host advertises `MDNS_NAME` on `PORT` for the `local` profile after listening, and unpublishes on shutdown; `web/src/mdns-dev.ts` advertiser-only entry wired into `npm run dev`; `error` log on a name conflict
- [ ] `.env.example` (both keys, documented), `npm run setup` (reports both ports, drift check)
- [ ] `client/vite.config.ts`: Vite on `PORT`, proxy target `API_PORT`
- [ ] Run modes: `BIFROST_RUN` and `WEB_HOST` (zod, shared `.env`); the web host's `web` mode (serves `client/dist-standalone`, forwards nothing, same rules as `nginx.conf`); mode-aware checks and logs (the `PORT` check only in `full`; the CLI hint in `api`; mDNS off on a loopback `WEB_HOST`; a refusal naming the fix when the needed build is missing); `npm run build` builds both clients
- [ ] `scripts/start.ts` + root `npm start`; `ecosystem.config.cjs` (two apps); `start-pm2.sh`; `start-launchd.sh` (the plists for the mode, replacing the old single plist and any other mode's plists on re-run); compose profiles `api`/`web`; `Dockerfile` + `docker-compose.yml` (two services, health checks)
- [ ] `scripts/backup-agent.sh` → `API_PORT`, mode-aware skip in `web` mode; `scripts/resilience.ts` → API on a random `API_PORT`
- [ ] `e2e/support/server.ts`: spawn both on free ports, all suites through the web host; load harness `--direct`
- [ ] `client/src/core/api.ts`: `ApiError` code `HUB_UNAVAILABLE` → `HubUnreachableError` (unit test); rewrite PLAN-32's journey 17 to stop the web host, plus an API-only-down step
- [ ] Upgrade path: `start-launchd.sh` replaces the old single plist on re-run; `start-pm2.sh` removes the old `bifrost` app; API boot check for nothing on `PORT`; upgrade section in `CHANGELOG`/`README.md`; hand-tested upgrade under PM2 and launchd
- [ ] `.claude/skills/verify/SKILL.md`, `.claude/skills/live-verify/SKILL.md`: both processes, the same URL
- [ ] Docs: `docs/pm2.md`, `docs/launchd.md`, `docs/docker-linux.md`, `docs/observability.md`, `README.md`, `architecture.md` (one process → two, the proxy, `trustProxy`; supersedes the 2026-07-12 one-process decision with a new row), `project-structure.md` (fifth workspace)
- [ ] Hand-run every row of the "Every way of running Bifrost" table on the owner's Mac (Docker on CI's image build plus a Linux `compose up` if available), with results in `progress.md`
- [ ] `decisions.md`, `progress.md`; archive this file into `completed/` in the PR
- [ ] Cleanup: the spike stays in the session scratchpad and is never committed; no stray processes, plists or PM2 apps left from testing; the PR lists deletions

## Acceptance criteria

1. `http://bifrost.local:4646` opens the hub exactly as before: same URL, same QR, same mDNS name. The API answers on `API_PORT` on loopback only, and is unreachable from another LAN device.
2. Every e2e suite (browser, CLI, API) passes **through the web host**, and an installed CLI from before this plan works unchanged against it.
3. SSE events arrive with no added delay through the proxy. A 1 GB upload keeps the proxy's and the API's RSS within the flat-memory bound. Range, zip and Brotli streams pass through intact.
4. With two devices behind the proxy, the login throttle, presence and upload attribution see each device's own IP, and a forged `X-Forwarded-For` from the LAN has no effect.
5. With the API stopped, the web host still serves the client, proxied paths return `502 HUB_UNAVAILABLE`, and the hub shows "The Bifröst is closed" with "Try again". Starting the API again closes it.
6. `npm run dev`, `npm start`, PM2, launchd and Docker each start both processes with one command, stop both cleanly with one command, and print or serve the same URL as today. The backup agent and Prometheus keep working without any change to their configuration.
7. `test:load` before and after this plan on the same machine is recorded in `progress.md` (throughput, p99, upload RSS), and shows no 5xx and no flat-memory breach.
8. Upgrading the owner's existing single-process install (PM2 and launchd) with the documented command leaves `bifrost.local:4646` working, with no old process left behind. If the web host is not running, the API logs an error saying so within its grace period.
9. With only the API stopped, the hub shows "The Bifröst is closed" (from the web host's 502), and `/go/<slug>` shows the HTML closed page instead of raw JSON.
10. `bifrost.local` keeps resolving while the API server is stopped or restarting, because the web host answers for it. With the API down, `http://bifrost.local:4646` still opens the hub and shows "The Bifröst is closed".
11. After the upgrade, exactly one `bifrost` service and name is on the network (checked with `dns-sd -B _http._tcp` on the Mac). In `npm run dev`, `bifrost.local` resolves as before.
12. Losing and regaining Wi-Fi on the same address leaves the web host running and re-advertising within the watcher's interval, as the server does today.
13. With no new key set, every earlier criterion holds: the default is the full hub on the LAN.
14. `BIFROST_RUN=api` starts only the API on loopback; the docs open; the CLI works with `--host 127.0.0.1:4647`; no mDNS; no "nothing on `PORT`" error.
15. `BIFROST_RUN=web` serves the standalone client on `PORT` with zero server requests, `bifrost.local` resolves on the LAN, and its fallback, cache and header behaviour match the VPS container.
16. `WEB_HOST=127.0.0.1` makes the web page reachable only from the Mac, and mDNS is off with an `info` line saying why.
17. Every launcher (`npm start`, PM2, launchd, compose) starts exactly the processes of the chosen mode, and switching modes leaves no process from the previous one running.

## Test checklist

- [ ] `web/` unit/integration: proxied paths, SPA fallback, `502 HUB_UNAVAILABLE`, forwarded IP, no body limit (criteria 3–5)
- [ ] Server: `trustProxy` loopback-only (a non-loopback `X-Forwarded-For` is ignored); config validation `API_PORT ≠ PORT` (criterion 4)
- [ ] `scripts/start.ts`: signal forwarding and either-child-dies exit (criterion 6); the process set per mode (criterion 17)
- [ ] Mode smoke test (CI, on the build): boot each of `full`, `api`, `web`, plus `WEB_HOST=127.0.0.1`; assert which ports listen, which client is served, that `web` makes no forwarded request, and the mDNS on/off decision (as a unit test of the decision, since CI cannot multicast) (criteria 13–16)
- [ ] e2e: the full net through the web host; login throttle from two forwarded IPs; API stopped → sheet → restart (criteria 2, 4 and 5)
- [ ] `test:load` before vs after (criterion 7)
- [ ] `web/src/mdns.test.ts` (the moved suite): publish with `host`, error-handler and guard behaviour, the network-change rebuild (criterion 12)
- [ ] Integration: the web host advertises only for the `local` profile and unpublishes on shutdown; the API server no longer imports a responder (criteria 10 and 11)

**Manual**
- [ ] On the owner's Mac: each mode by hand under PM2 and launchd, then back to `full` (criteria 13–17)
- [ ] On the owner's Mac and an iPhone: stop the API, and `bifrost.local` still resolves and shows the closed sheet; restart it, and the sheet closes; `dns-sd -B _http._tcp` shows one `bifrost` after the upgrade (criteria 10 and 11)
- [ ] The owner's existing bookmarks and home-screen icons still open the hub; `bifrost status` from the installed CLI; PM2 or launchd restart of each process separately (criteria 1, 2 and 6)
