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

You need **Node.js 20+** and **npm 10+**. macOS is the main host.

```bash
npm install                  # install dependencies
./bifrost setup              # creates .env, asks you for an admin PIN, makes the storage folders + database
./bifrost dev                # run with hot reload
```

Open `http://bifrost.local:4646` from any device on the same Wi-Fi, or scan the QR code printed in the terminal.

Every task in this repo runs through `./bifrost`. Run `./bifrost help` to see them all.

## Run Bifrost

### On your Mac

```bash
./bifrost build                          # build once after every pull

./bifrost start                          # run now, in this terminal (Ctrl-C stops it)
./bifrost service pm2                    # or keep it running: restarts on crash and at login
./bifrost service launchd                # the same without installing PM2 (pick one)
```

Add flags to change what runs. They work the same with `start` and with `service`:

```bash
./bifrost start --obs                    # + Grafana, Loki, Prometheus and Tempo in Docker, traces on
./bifrost start --web docker             # API on the Mac, web host in Docker
./bifrost start --web docker --obs       # API on the Mac, web host + Grafana in Docker, all connected
./bifrost start --web none               # the API alone (for the CLI)
./bifrost start --standalone             # only the browser tools site, no API
./bifrost start --otel                   # traces on, without starting Grafana

./bifrost service pm2 --web docker --obs # any of the above, always on
```

No `.env` changes are needed for any of these: the flags decide, and an old `BIFROST_RUN`, `MDNS_ADVERTISER` or `OTEL_ENABLED` line in `.env` is removed for you. `.env` holds the PIN, folders, limits and ports. With `start`, Ctrl-C also stops the containers it started.

Grafana is at `http://localhost:4648` (admin / bifrost). The `--web docker` setups need Docker Desktop with Docker Compose 2.20 or newer. See [`docs/docker-mac.md`](docs/docker-mac.md).

### In Docker

**The client alone**: the browser tools site, with no server behind it. Works with any Docker version:

```bash
./bifrost docker up standalone               # http://localhost:8080
./bifrost docker up standalone --port 9000   # http://localhost:9000
./bifrost docker logs standalone             # follow its logs
./bifrost docker down standalone             # stop it
```

**Behind your reverse proxy** on a server (Caddy, Traefik, nginx…):

```bash
./bifrost docker up standalone --network <proxy-network>   # find the name with: docker network ls
```

**The whole hub on a Linux host** (a Raspberry Pi, a home server):

```bash
./bifrost docker up                      # API + web host
./bifrost docker up --obs                # + Grafana stack, traces on
./bifrost docker up api                  # the API alone
./bifrost docker up web-standalone       # the browser tools site, served to your network
./bifrost docker logs                    # follow the hub's logs
./bifrost docker down                    # stop it (add --obs if you started it with --obs)
```

**Only the Grafana stack**, next to Bifrost running natively:

```bash
./bifrost docker up obs                  # Grafana at http://localhost:4648
./bifrost docker down obs                # stop it (add -v to also delete its data)
```

Everything except the standalone site needs Docker Compose 2.20 or newer (`docker compose version`). A machine without `node_modules` can use the plain `docker compose` commands in [`docs/docker-linux.md`](docs/docker-linux.md) and [`docs/standalone.md`](docs/standalone.md).

### Back up and restore

```bash
./bifrost backup                         # zip the database and storage/ now (safe while running)
./bifrost backup agent install           # macOS: back up to a cloud folder on a schedule (BACKUP_* in .env)
./bifrost backup agent status            # last run, next due date
./bifrost restore <zip-or-folder>        # stop Bifrost first
```

## The API

Every call is under `/api/v1/`, and a saved document's raw content is at `/<kind>/api/v1/<slug>`:

```bash
curl -sS http://bifrost.local:4646/api/v1/health
curl -sS http://bifrost.local:4646/edda/api/v1/<slug>
```

Browse and try every endpoint in Swagger UI at `http://127.0.0.1:4647/docs`, on the machine running Bifrost. See [`docs/api.md`](docs/api.md).

## CLI

`bifrost` is a command-line client for a running hub. It pushes and pulls files, reads and writes the shared clipboard, fetches saved documents, resolves go-links and runs a speed test.

Install it from the latest release:

<!-- CLI_INSTALL_START -->

```bash
npm install -g https://github.com/0xSiddhant/bifrost/releases/download/v1.4.0/bifrost-cli-1.4.0.tgz
```

<!-- CLI_INSTALL_END -->

```bash
bifrost push ~/Desktop/notes.pdf     # send a file
bifrost pull                         # list what Downloads is offering
bifrost clip | pbcopy                # read the shared clipboard
bifrost doctor                       # check config, connection and version
```

Every command is described in [`cli/README.md`](cli/README.md). On the machine running Bifrost, `./bifrost build` and `./bifrost start` keep the installed `bifrost` in step with the code.

`./bifrost` (with `./`) is this repo's task runner; plain `bifrost` is this client.

## All `./bifrost` commands

```bash
./bifrost help                           # every command
./bifrost help <command>                 # usage, options, and what each example runs
./bifrost man                            # the full manual
./bifrost -n <command>                   # dry run: show what would run
```

**Develop**

```bash
./bifrost setup                          # storage folders + database (first run, safe to repeat)
./bifrost dev                            # hot reload
./bifrost dev --standalone               # hot reload, browser tools site only
./bifrost build                          # production build
./bifrost build --standalone             # only the browser tools site
./bifrost preview                        # build the browser tools site and serve it on :4173
./bifrost spec                           # regenerate server/openapi.json after changing a route
./bifrost db migrate                     # apply database migrations
./bifrost db generate --name <slug>      # create a migration from schema.ts
./bifrost db studio                      # browse the database
```

**Check and test**

```bash
./bifrost lint                           # ESLint (add --fix to fix)
./bifrost typecheck                      # TypeScript
./bifrost audit                          # npm audit, must find 0
./bifrost test                           # all unit tests
./bifrost test unit server               # one workspace: server, client, cli, web, e2e or scripts
./bifrost test e2e                       # end-to-end, against the build
./bifrost test e2e ui                    # one e2e suite: ui, cli or api
./bifrost test load -- --profile stress  # load tests, on demand
./bifrost test resilience                # restart and crash tests, on demand
./bifrost test all                       # everything CI runs
```

**Run, data and Docker**: see [Run Bifrost](#run-bifrost) above, plus:

```bash
./bifrost logs                           # follow the API's log
./bifrost docker ps                      # what is running in Docker
./bifrost docker config                  # check every compose file still parses
./bifrost docker smoke                   # check the standalone image
```

`npm run dev`, `npm run build`, `npm start` and `npm test` still work too.

## Testing

```bash
cd e2e && npx playwright install chromium webkit && cd ..   # once, for the browser tests
./bifrost test all                                          # audit, lint, typecheck, unit, build, end-to-end
```

Unit tests live next to the code they test. End-to-end tests live in `e2e/` and drive the built app from outside. [`docs/testing.md`](docs/testing.md) explains every kind of test and how to run each one.

## Project docs

Architecture, rules, plans and progress live in [`.agents/`](.agents/). Start with [`.agents/plans/README.md`](.agents/plans/README.md).

Operating & deploying:

- [`docs/pm2.md`](docs/pm2.md) · [`docs/launchd.md`](docs/launchd.md) — run as a service on macOS
- [`docs/observability.md`](docs/observability.md) — optional Grafana + Loki + Alloy + Prometheus + Tempo stack
- [`docs/docker-linux.md`](docs/docker-linux.md) — Docker on a Linux host, including the plain `docker compose` commands
- [`docs/docker-mac.md`](docs/docker-mac.md) — on the Mac, the web host in Docker beside the native API, with a native advertiser for `bifrost.local`
- [`docs/standalone.md`](docs/standalone.md) — the browser tools site: what it includes, its build settings, running it behind a proxy
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
