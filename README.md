<div align="center">

# 🌈 Bifrost

**A private LAN hub — file transfer & sync, a workbench of dev tools, and a drawer of network utilities.**

![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)
![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/network-mDNS%20%2F%20intranet%20only-8A2BE2)

<!-- TODO: add demo video when the features land (PLAN-02+) -->
<img src="docs/assets/screenshot-home.png" alt="Bifrost home — Aurora theme, the three transfer portals" width="720" />

<img src="docs/assets/screenshot-receive.png" alt="Receive files — live download list with per-type icons" width="720" />

<p>
  <img src="docs/assets/screenshot-send-phone.png" alt="Send files on a phone" width="230" />
  <img src="docs/assets/screenshot-receive-phone.png" alt="Receive files on a phone" width="230" />
  <img src="docs/assets/screenshot-daybreak-phone.png" alt="Daybreak (light) theme on a phone" width="230" />
</p>

</div>

---

## What is Bifrost?

Bifrost turns one machine on your local network — a Mac natively, or a Linux box (Raspberry Pi included) via Docker — into a private hub for every other device in the house: iPhone, Android, iPad, any laptop. Files move between devices, structured documents get their own workbench, and a handful of everyday utilities live one tap away. No cloud, no public internet, no accounts. Advertised over mDNS at `http://bifrost.local`.

The app is organized into three category tabs, plus a few things that work everywhere.

### 🌈 Midgard — transfer & sharing

- 📤 **Send** — multi-file upload (streamed, 2 GB configurable limit) into a staging area you can preview, rename or delete before publishing to Downloads — or send straight into a named folder — and every device gets a banner
- 📥 **Receive** — drop a file into a folder in Finder and it appears on every device instantly (SSE); folders are browsable one level deep and download as a `.zip`
- 👁 In-browser previews for images, PDF, video (seekable), and Markdown
- 📋 **Hermes** — clipboard/text sync across devices
- 🔖 **Accio** — read-later shelf with tags and best-effort page-title lookup
- 🎞 **Saga** — present a deck fullscreen: drop a `.md` file (`---` splits the slides, `<!-- notes: … -->` feeds the presenter panel) or a `.pdf` (one page per slide), or open a saved Edda; keyboard navigation, resizable text that carries into fullscreen, and a shortcuts overlay — nothing is uploaded or stored
- A scan-to-join QR for the server URL, right on the home page

### 🪄 Ollivanders — dev tools ("the tool chooses the maker")

- 🧿 **Runestone** — JSON viewer/editor with in-editor find and tree collapse-all
- ⚖️ **Variant** — structural JSON diff (key order & formatting are noise) with a raw-text fallback and cross-pane reveal; export as an RFC 6902 JSON Patch or a git-shaped unified `.patch`
- 📖 **Edda** — Markdown editor with live preview (Mermaid diagrams render inline); share as a rendered page, raw `text/markdown`, or a printable HTML/PDF export
- 🃏 **Loki** — JavaScript workbench: transforms, a regex tester, and a sandboxed Web-Worker runner
- 🌳 **Groot** — YAML workspace: folding, comment-preserving formatting, a tree view, YAML ⇄ JSON, and an advisory rail for the traps YAML hides in plain sight (`country: no` is a string here and `false` to a YAML 1.1 reader)
- 🌐 **Atlas** — XML workspace: format, minify, fold; an Apple property list also opens as an editable, Xcode-shaped table
- 🗜 **Brotli** — compress text or a file, or decompress a `.br`, with a live gzip comparison and a one-click hand-off into whichever editor above the result fits
- 🗃 **Pensieve** — one saved-document library across Runestone, Edda, Groot and Atlas; every saved doc doubles as a public data URL
- 💡 A header bulb opens a **guide panel** — a per-page format reference (JSON, Markdown, XML, YAML, JavaScript, Brotli) with copyable code examples

### 🎪 Diagon Alley — utilities

- 🔳 **Sigil** — QR generator ("Make a QR")
- 🧹 **Nimbus** — LAN speed test: download/upload/latency between a device and the bridge, with per-device history
- 🚪 **Portkey** — LAN go-links: `bifrost.local/go/<slug>` redirects, with a QR per link
- Plus 12 more pure-client utilities that expand in place: Base64, UUID, Unix time, URL encode/decode, ASCII/Hex/Binary, JWT decode, colour tools (Iris), a CIDR calculator, a text-case converter, a password generator, a cron expression explainer, and SHA-256 hashing (host-only — needs a secure context browsers only grant on `localhost`)

### Everywhere

- 🎨 Themes (Aurora, Daybreak, Ghibli Dusk, Olympus, Gryffindor, Slytherin, Tokyo built in), bundled with the client: add one as a JSON file and rebuild
- 🌌 **Nótt** — idle screensaver overlay (particle constellations), desktop-only and tunable from Heimdall
- 🛡 **Heimdall** — hidden admin panel (secret gesture/shortcut + PIN)
- 📜 **Wardens** — device presence dashboard with character-name aliases; upload history & activity log in Heimdall
- 🔁 Restart-safe: all state survives server stop/start

Each stateful page keeps its own URL; the Diagon Alley utilities open inline at `/diagon-alley/<tool>`.

## Quick start

> Prerequisites: **Node.js ≥ 20**, **npm ≥ 10**, macOS (primary host target).

```bash
# 1. install dependencies
npm install

# 2. create local env from template
cp .env.example .env

# 3. create runtime folders (storage/{uploads,downloads,tmp,data,logs}) and the database
./bifrost setup

# 4. run in dev (API + client, hot reload)
./bifrost dev
```

Then open `http://bifrost.local:<PORT>` from any device on the same Wi-Fi — or scan the QR printed in the terminal.

Every task in this repo runs through **`./bifrost`**: `./bifrost help` lists them all. See [Commands](#commands-bifrost) below.

## Run it as a service (macOS)

For an always-on hub that survives crashes and reboots, run it natively (this is
the production mode — mDNS/`bifrost.local` works, unlike Docker on macOS). One
command builds and starts it:

```bash
./bifrost service pm2          # via PM2 (rich logs/monitoring; installs pm2)
# — or —
./bifrost service launchd      # via launchd (zero extra deps, native)
```

Pick one, not both. On a machine that has not run `npm install` yet, the
scripts behind them work on their own: `sh scripts/start-pm2.sh`,
`sh scripts/start-launchd.sh`. Details + how to choose: [`docs/pm2.md`](docs/pm2.md) ·
[`docs/launchd.md`](docs/launchd.md).

Bifrost runs as **two processes** (PLAN-36): the **web host** on `PORT` (4646),
which serves the page, answers for `bifrost.local` and forwards API calls, and
the **API server** behind it on `127.0.0.1:API_PORT` (default 4647, never on the
LAN). The address is the same as ever. Restarting the API alone leaves the page
up, showing "The Bifröst is closed" until it is back. `BIFROST_RUN` in `.env`
picks what runs: `full` (both, the default), `api` (the API alone, for the CLI
on this Mac: `bifrost --host 127.0.0.1:4647`) or `web` (the standalone tools
site alone).

The API is versioned in its path (PLAN-37): every call is `/api/v1/…`, and a
saved document's raw content is at `/<kind>/api/v1/<slug>`, which is what the
Pensieve's "API" link and "Copy curl" give you:

```bash
curl -sS http://bifrost.local:4646/api/v1/health
curl -sS http://bifrost.local:4646/edda/api/v1/<slug>
```

Paths from before versioning (`/api/health`, `/edda/api/<slug>`) still answer,
identically, as v1, with a `Deprecation` header pointing at the new path. Links
saved elsewhere and older scripts and CLIs keep working.

Every operation is browsable, and can be tried, in Swagger UI at
`http://127.0.0.1:4647/docs` on the server machine (not `bifrost.local`: the API
listens on loopback). See [`docs/api.md`](docs/api.md).

### Upgrading from a version before PLAN-36

Re-run the same command you installed with. `start-pm2.sh` deletes the old
`bifrost` app and `start-launchd.sh` the old `local.bifrost` plist **before**
starting the two new processes, so nothing old holds the API's port or
advertises a second `bifrost.local`. On Linux, `./bifrost docker up -- --remove-orphans`
(see [Docker](#docker)). If the web host is ever missing after an upgrade, the API
logs an error saying so ten seconds after it starts.

**Optional Grafana view of the logs** (Docker containers; works alongside the
native run — Alloy tails `storage/logs/`). In a second terminal:

```bash
./bifrost docker up obs        # http://localhost:3000  (admin / bifrost)
```

See [`docs/observability.md`](docs/observability.md). Back up all state
(`storage/`) any time with `./bifrost backup`, or schedule it
(macOS): set `BACKUP_CLOUD` (dropbox / icloud / onedrive / gdrive / path) in
`.env` and run `./bifrost backup agent install` — a launchd agent checks daily
and backs up every `BACKUP_INTERVAL_DAYS` into the cloud folder, only while the
server is running. `./bifrost backup agent status` shows the schedule, last run,
and next due date; `backup agent stop` / `backup agent start` pause and resume it.

## CLI

`bifrost` is a command-line client for a running hub — push and pull files, read
and write the shared clipboard, fetch saved documents, resolve go-links, check
server and device state, run a speed test. It is a third npm workspace
(`cli/`) that consumes the existing API and adds no server routes of its own.

Install it from the latest release's tarball:

<!-- CLI_INSTALL_START -->

```bash
npm install -g https://github.com/0xSiddhant/bifrost/releases/download/v1.4.0/bifrost-cli-1.4.0.tgz
```

<!-- CLI_INSTALL_END -->

```bash
bifrost push ~/Desktop/notes.pdf     # send a file to the bridge
bifrost pull                         # list what Downloads is offering
bifrost clip | pbcopy                # read the shared clipboard
bifrost doctor                       # check config, host, server, CLI version
```

Every command, the config file, the `--host`/discovery story, and how to run it
straight from a checkout without installing: [`cli/README.md`](cli/README.md).
On the host machine `./bifrost build` and `./bifrost start` re-install the global
`bifrost` from what is checked out, so it never drifts from the server it talks
to.

## Commands (`./bifrost`)

`./bifrost` at the repo root runs every task in the repo from one place: develop,
test, run, back up, and every Docker combination. Each command runs the same npm
or shell script as before, so nothing about how a task works changes.

```bash
./bifrost help              # every command, grouped
./bifrost help test         # one command: usage, options, examples, and what each runs
./bifrost man               # the full manual
./bifrost list --json       # the whole table, for scripts and AI agents
./bifrost -n build          # --dry-run: print what would run, run nothing
./bifrost test unit server -- documents   # anything after -- goes to the underlying tool
```

`./bifrost` (with `./`) is the repo's task runner. Plain `bifrost` on your PATH
is the [LAN client](#cli), a different program. `./bifrost` needs `npm install`
to have run once.

| Command | What it does |
| --- | --- |
| **Develop** | |
| `./bifrost setup` | First run: storage folders, `.env` from the template (warns about keys it is missing), DB migrations |
| `./bifrost dev [--standalone]` | Hot reload: the API, Vite on `PORT` and the mDNS name. `--standalone`: the browser-only site on Vite's own port |
| `./bifrost build [--standalone]` | Production build (both clients, the API, the web host), then re-installs the global `bifrost` CLI. `--standalone`: only `client/dist-standalone/`, failing if the bundle can reach a server |
| `./bifrost preview` | Build the standalone site, then serve exactly that output on `:4173` ([`docs/standalone.md`](docs/standalone.md)) |
| `./bifrost spec` | Regenerate `server/openapi.json` after changing a route (commit it) |
| `./bifrost db migrate` · `db generate --name <slug>` · `db studio` | Apply migrations · write a new one from `schema.ts` · browse the data in [Drizzle Studio](https://local.drizzle.studio) |
| **Check & test** | |
| `./bifrost lint [--fix]` · `typecheck` · `audit` | ESLint with the module boundaries · `tsc` over `scripts/` and every workspace · `npm audit` (must be 0) |
| `./bifrost test` | Every unit suite. `test unit <workspace> [-- <filter>]` runs one: `server`, `client`, `cli`, `web`, `e2e`, `scripts` |
| `./bifrost test e2e [ui\|cli\|api]` | End-to-end against the build (run `build` first): all of it, or one suite |
| `./bifrost test load [-- --profile <name>]` | On-demand load, stress, spike, soak and fan-out runs ([`docs/performance.md`](docs/performance.md)) |
| `./bifrost test resilience [--cycles <n>]` | 50 restarts with SIGKILLs mid-write, the database integrity-checked each time (on demand) |
| `./bifrost test all` | **Everything, as CI runs it:** audit → lint → typecheck → unit → build → e2e. See [Testing](#testing) |
| **Run** | |
| `./bifrost start [--mode full\|api\|web]` | Run the build in the foreground: the processes `BIFROST_RUN` picks (or `--mode`), as one. Ctrl-C stops the web host, then the API |
| `./bifrost service pm2\|launchd` | Always-on on macOS: build, then (re)start under PM2 or launchd ([`docs/pm2.md`](docs/pm2.md) · [`docs/launchd.md`](docs/launchd.md)) |
| `./bifrost logs` | Pretty-tail the API's JSON log |
| **Data** | |
| `./bifrost backup [--include-env] [--meta]` | Archive the database and `storage/` to `BACKUP_DIR` (safe while running) |
| `./bifrost backup agent install\|uninstall\|start\|stop\|status` | The scheduled cloud backup (macOS launchd; `BACKUP_*` in `.env`): add/remove it, pause/resume it, or see the last run and next due date |
| `./bifrost backup agent run [--force]` | Run the scheduled job now; `--force` skips the "not due yet" check |
| `./bifrost restore <path> [--force]` | Restore a `.zip`, one backup's folder, or a folder of backups (the newest). Checks the checksum; refuses a live server unless `--force` |
| **Docker** | |
| `./bifrost docker up\|down\|logs\|ps [<target>]` | Any combination below. `up` builds and starts detached; `down -v` also deletes volumes |
| `./bifrost docker config` · `docker smoke [<image>]` | Check every compose combination parses · smoke-test a standalone image (both as CI does) |

The npm scripts the root `package.json` keeps (`npm run dev`, `npm run build`,
`npm start`, `npm test`, `npm run lint`, …) still work: CI, husky and your
muscle memory use them. Their variants moved into `./bifrost` as flags and
subcommands.

## Docker

Each process has its own image (`docker/`) and its own compose file
(`compose/`); the root `docker-compose.yml` puts the hub's pieces in one
project. Every combination is one `./bifrost docker` target. The plain
`docker compose` command is shown beside it for a machine with only Docker and a
clone (no `node_modules`). Before any of them: `cp .env.example .env` and set
`HEIMDALL_PIN`. Needs **Docker Compose ≥ 2.20** (`docker compose version`): the
files use `include:` and a top-level `name:`, which older Compose rejects.

| # | Where | Runs in Docker | `.env` | `./bifrost` | Plain `docker compose` |
| --- | --- | --- | --- | --- | --- |
| 1 | Linux host | The hub: API + web host | `BIFROST_RUN=full` | `./bifrost docker up` | `docker compose up -d --build` |
| 2 | Linux host | The hub + Grafana, Loki, Alloy, Prometheus, Tempo | `BIFROST_RUN=full` | `./bifrost docker up --obs` | `docker compose --profile observability up -d --build` |
| 3 | Linux host | The API alone | `BIFROST_RUN=api` | `./bifrost docker up api` | `docker compose -f compose/api.yml --env-file .env up -d --build` |
| 4 | Linux host | The web host alone, serving the standalone site to the LAN | `BIFROST_RUN=web` | `./bifrost docker up web` | `docker compose -f compose/web.yml --env-file .env up -d --build` |
| 5 | Mac | The web host, beside the native API and advertiser | `BIFROST_RUN=api`, `MDNS_ADVERTISER=host` | `./bifrost service pm2` (or `launchd`), then `./bifrost docker up web-mac` | `docker compose -f compose/web.yml -f compose/web.bridge.yml --env-file .env up -d --build` |
| 6 | Mac or Linux | Only the Grafana stack, beside a native hub | any | `./bifrost docker up obs` | `docker compose -f compose/observability.yml --env-file .env --profile observability up -d` |
| 7 | A cloud machine | The standalone site, behind your reverse proxy | none needed | `./bifrost docker up standalone --network <proxy-network>` | `BIFROST_DOCKER_NETWORK=<proxy-network> docker compose -f compose/standalone.yml up -d --build` |

Combination 6 runs beside any of 1, 3, 4 or 5, or beside a native hub (the
default on the Mac). It tails `storage/logs/`, so it never needs the hub to be in
Docker. The Mac never runs the API in Docker (Finder drops need native file
watching), so 1–4 are Linux only. 5 is the one piece that may run in Docker on
the Mac; read [`docs/docker-mac.md`](docs/docker-mac.md) first.

The same target works with every verb:

```bash
./bifrost docker ps  web-mac          # docker compose -f compose/web.yml -f compose/web.bridge.yml --env-file .env ps
./bifrost docker logs                 # follow the hub: docker compose logs -f
./bifrost docker down api             # docker compose -f compose/api.yml --env-file .env down
./bifrost docker down obs -v          # stop the Grafana stack and wipe its stored logs and dashboards
./bifrost docker up --no-build        # start the images already built
./bifrost docker up -- --remove-orphans   # upgrading from the single pre-PLAN-36 service
./bifrost docker config               # every combination above still parses (CI runs the same list)
./bifrost docker smoke                # run bifrost-standalone:latest read-only and check it (as CI does)
```

Linux hosts use host networking: `bifrost.local`, each device's real address,
and the API on the host's loopback. State is the `./storage` bind mount, shared
by every container. Details: [`docs/docker-linux.md`](docs/docker-linux.md) (images,
permissions, upgrading), [`docs/docker-mac.md`](docs/docker-mac.md),
[`docs/standalone.md`](docs/standalone.md) (the proxy, build arguments) and
[`docs/observability.md`](docs/observability.md).

## Testing

**One command runs everything:** `./bifrost test all` (`npm audit`, lint, typecheck, unit + integration tests, build, end-to-end). The first time, install Playwright's browsers once: `cd e2e && npx playwright install chromium webkit`.

Tests live in two kinds of place, on purpose. Unit and integration tests sit **beside the code they test**, in `server/`, `client/` and `cli/`. End-to-end tests live in **`e2e/`** and only ever drive the built app from outside. [`docs/testing.md`](docs/testing.md) is the map: every kind of test, where it lives, how to run and replay one, and what each one protects. Load, stress and soak runs are on demand, never in CI: `./bifrost test load` ([`docs/performance.md`](docs/performance.md)).

## Project docs

Architecture, rules, plans and progress live in [`.agents/`](.agents/). Start with [`.agents/plans/README.md`](.agents/plans/README.md).

Operating & deploying:

- [`docs/pm2.md`](docs/pm2.md) · [`docs/launchd.md`](docs/launchd.md) — run as a service on macOS
- [`docs/observability.md`](docs/observability.md) — optional Grafana + Loki + Alloy + Prometheus + Tempo stack
- [`docs/docker-linux.md`](docs/docker-linux.md) — Docker on a Linux host: one image per process, compose files you can combine (`docker compose up` is the hub, `--profile observability` adds Grafana)
- [`docs/docker-mac.md`](docs/docker-mac.md) — on the Mac, the web host in Docker beside the native API, with a native advertiser for `bifrost.local`
- [`docs/standalone.md`](docs/standalone.md) — the standalone site: the browser-only tools, run locally (`./bifrost dev --standalone` / `./bifrost preview`) or as a static container behind your reverse proxy
- [`docs/releasing.md`](docs/releasing.md) — automated releases (develop → main)
- [`docs/cloud-profile.md`](docs/cloud-profile.md) — checklist for a future internet deployment
- [`docs/offline-mode.md`](docs/offline-mode.md) — how pure-client pages keep working after the LAN drops
- [`docs/THEME-SPEC.md`](docs/THEME-SPEC.md) · [`docs/DESIGN.md`](docs/DESIGN.md) — themes & design system
- [`cli/README.md`](cli/README.md) — the `bifrost` command-line client
- [`docs/api.md`](docs/api.md) — the API docs (Swagger UI) at `http://127.0.0.1:4647/docs` on the server machine, and how to reach them from another one
- [`docs/testing.md`](docs/testing.md) — every kind of test, where it lives and how to run it
- [`docs/performance.md`](docs/performance.md) — the on-demand load harness: profiles, numbers, comparing two builds

## License

MIT
