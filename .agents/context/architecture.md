# Bifrost Architecture

The shape of the system and the rules that keep it that way. The code is the source of truth for detail; read it. The *why* behind each rule is in `memory/decisions.md`.

Two Node/Fastify processes, one address (PLAN-36). The **web host** (`web/`) listens on `PORT`, serves the client, answers for `bifrost.local` (mDNS), and forwards the API's path roots to the **API server** (`server/`) on loopback `API_PORT`. The browser sees one origin.

## The three modularization rules (non-negotiable)

1. **Vertical slices.** `server/src/modules/<feature>/` holds that feature's routes, usecases, services and DB schema; shared infrastructure lives in `src/core/` only. The client mirrors it: `client/src/features/<feature>/` over `client/src/core/`.
2. **Modules never import each other, only `core`.** Cross-feature communication goes through the core event bus (`bus.emit('file.uploaded', meta)`). `eslint-plugin-boundaries` makes a violating import a build failure.
3. **A deployment manifest decides what loads.** `DEPLOY_PROFILE=local|cloud` picks the modules `server/src/app.ts`'s `MANIFEST` registers: `local` is everything, `cloud` the internet-safe ones.

## Layers inside every module

`route (HTTP) → usecase (business rules) → service/repository (infrastructure)`. Usecases depend on repository interfaces, never on Drizzle, fs or chokidar directly; `module.ts` injects the implementations. That keeps a later SQLite → Postgres swap mechanical.

## Module registry

| Module | Purpose | Profile |
|---|---|---|
| `health` | `GET /api/v1/health`; proves the module contract | both |
| `file-transfer` | Upload to a staging area (preview, rename, publish) or straight into a download folder; downloads one level deep, folder → zip; live folder watch | local |
| `previews` | In-browser image/PDF/video/markdown preview, range requests | local |
| `clipboard` | Cross-device clipboard sync (Hermes) | local |
| `heimdall` | Admin panel behind a gesture and PIN | both |
| `qr-tool` | QR generator and server-URL QR (Sigil) | both |
| `presence` | Connected devices (Wardens), character aliases | local |
| `audit-log` | Activity log, an event-bus subscriber | local |
| `runestone` | JSON/JSONC editor and saved documents | both |
| `edda` | Markdown editor, preview, saved documents, public pages | both |
| `groot` | YAML editor and saved documents; the server never parses YAML | both |
| `atlas` | XML editor with a plist table; the server never parses XML | both |
| `variant` | JSON and text diff, patch export; capability-only (all client) | both |
| `loki` | JS workbench; the server owns run/fetch policy only | both (run UI local) |
| `brotli` | Compress and decompress through Node's `zlib`, streamed, capped | both |
| `accio` | Read-later shelf with title enrichment | local |
| `nimbus` | LAN speed test; the server moves bytes, the client keeps time | local |
| `portkey` | LAN go-links, `/go/:slug` | local |
| `screensaver` | Idle overlay (Nótt); policy only, the canvas is client | both |
| `client-logs` | Browser reports relayed into the pino archive | both |
| `metrics` | Runtime snapshot log line, Prometheus at `/metrics` | both |
| `toolbox` | Capability-only: Diagon Alley's in-place tools | both |
| `saga` | Capability-only: markdown and PDF slideshow | both |
| `offline-mode` | Policy only: which pages the Offline switch warm-loads | both |

**Capability-only** modules register no routes; they exist so `MANIFEST` and `/api/v1/capabilities` name them. **Policy-only** modules serve and persist Heimdall-tunable settings for a feature that runs in the client.

Client-only features with no module: the **Pensieve** (one library: a `Promise.allSettled` fan-out over each document kind's list API, merged in the browser, `client/src/core/library/`), the **Guide panel** (`core/guide/`), Mermaid and PDF export in Edda, and the per-tab **drafts** (below).

## Core services (shared kernel, no feature imports)

`config` (zod-validated `.env`, overlaid with DB settings) · `reserved-roots` (the one list of top-level path roots; Portkey slugs may not be one) · `db` (better-sqlite3 + Drizzle, WAL) · `logger` (pino, rotated JSON files, text `logLevel` key) · `bus` (typed event bus) · `sse` (the SSE hub) · `auth` (`app.requireAdmin`, PIN sessions) · `http` (versioning, contract guard, schemas, ranges, docs) · `paging` · `backup`. The client's `core/` holds the shared UI, editors' JSON/YAML/XML/Markdown stacks, `notify`, `library`, `drafts` and the API helpers.

## Two client builds (PLAN-35)

One client source, two builds by Vite mode:

- **The hub** (`client/dist/`): everything, served by the web host.
- **The standalone site** (`client/dist-standalone/`): the features that need no server, as static files (`docker/standalone.Dockerfile`, `docs/standalone.md`). It cannot reach a server by construction: `__HUB__` is a build literal, every request path is written `__HUB__ ? path : hubOnly('x')`, and `check-standalone` fails the build if a hub path survives.

`client/src/core/features.ts` declares each client feature once (id, URL roots, nav, `needsHub`); nav, routes and Heimdall read it through `hasFeature`. The server's `MANIFEST` still decides what a server *serves*: the security boundary no client build can be.

- **"The Bifröst is closed"** (`core/bridge.ts`, `core/ui/BridgeClosed.tsx`) is the one sheet for every needs-the-hub moment: a standalone stub, a hub that stopped answering, a hub-only deep link.
- **Settings** go through one `SettingsStore`: the hub's routes and SSE, or `localStorage` standalone.
- **Themes are client code** (`client/src/assets/themes/*.json`), validated by a test against the schema and the contrast floor. The household default reaches devices through `GET /api/v1/heimdall/access`.
- **Editor size caps are build constants**; the server warns at boot when its `.env` disagrees.
- **Standalone SEO:** `client/seoBuild.ts` writes a real HTML file per public page.

## Page load (PLAN-40, PLAN-41)

- Text assets are compressed at build time (`.br`, `.gz`) and served `preCompressed`; `/assets/` is immutable-cached, everything else `no-cache`.
- `client/bundleBudget.ts` fails the build when a heavy package (Markdown stack, Mermaid, pdf.js, CodeMirror, qrcode) reaches the first load, or the first load passes its gzipped budget.
- A page's styles live in a stylesheet that page imports; the shell's stylesheet is inlined (`client/inlineCss.ts`); first-paint fonts are preloaded.
- Lazy pieces sit behind `core/ui/ChunkBoundary`; every route loader has an 8 s `withChunkTimeout` and a `RouteBoundary`.
- Relic drawings load when the browser is idle. Seasonal decorations are plug-ins (`client/src/seasons/<name>/`) rendered into three `core/decor/DecorSlot`s; the shell names no decoration.
- Motion: short loops are Web Animations; long-running motion animates `transform` only, never a `filter`. Accent text uses `--accent-text`.

## Editor drafts, per tab (PLAN-43)

Unsaved work in Runestone, Edda, Groot, Atlas and Variant stays in this browser, per **tab, editor and workspace** (`localStorage`, `bifrost.drafts.v1.r.<editor>.<tab>.<workspace>`). The mechanism is `client/src/core/drafts/`; editors use `core/draftCache.ts` and `core/documentDrafts.ts`.

- **Identity:** a tab id in `sessionStorage`; a duplicated tab is detected over a `BroadcastChannel` and takes a new id.
- **Own draft:** restored silently. A saved document's draft carries a hash of the server copy; a mismatch asks Keep local / Use server.
- **Another tab's draft:** offered once, only from a tab known closed (departure marker + registry + 10 s grace), taken once.
- **Cleanup:** newest wins after 10 minutes.
- **The lock** is an IndexedDB transaction (`navigator.locks` needs a secure context; the hub is plain http).

## Two processes (PLAN-36)

| Process | Workspace | Listens on | Does |
|---|---|---|---|
| API server | `server/` | `127.0.0.1:API_PORT` (default `PORT + 1`) | REST, SSE, uploads, the database, `/metrics`, `/go/:slug` |
| web host | `web/` | `WEB_HOST:PORT` (`0.0.0.0:4646`) | the client with SPA fallback; forwards `/api`, `/<kind>/api`, `/go`, `/metrics`; `/healthz`; mDNS |

- **Why two:** the API can restart while the page and `bifrost.local` stay up; the client shows "The Bifröst is closed" instead of a browser error.
- **The proxy** is `@fastify/http-proxy`, timeouts off, pool unbounded (long-lived SSE streams).
- **`trustProxy: 'loopback'`** on the API: only the web host's `X-Forwarded-For` is believed, so every reader of `request.ip` sees the device.
- **API down:** forwarded paths answer `502 HUB_UNAVAILABLE`; `/go/*` a "Bifröst is closed" page with `503`.
- **Run modes** (`BIFROST_RUN`, set by the launcher, never `.env`): `full` (both), `api`, `web` (standalone build, forwards nothing). `MDNS_ADVERTISER` and `OTEL_ENABLED` are launcher keys too.
- **Logs:** the web host writes `app-web.N.log` beside the API's `app.N.log`.

## The API

- **Versions (PLAN-37):** everything under `/api/v1/…` and `/<kind>/api/v1/:slug`; `/go/:slug` and `/metrics` are unversioned. Old paths are rewritten to v1 before routing (`core/http/versioning.ts`). v1 only grows; a breaking change is `/api/v2/<module>/…`. Guarded by `api-coverage.test.ts`, `openapi-compat.test.ts` and `legacy-paths.int.test.ts`.
- **Schemas (PLAN-32b):** every route declares its responses; `./bifrost spec` writes the committed `server/openapi.json` (OpenAPI 3.1). The contract guard (`core/http/contract.ts`, `API_CONTRACT_CHECK`) compares bytes before and after serialization: `strict` in tests (500 on a difference), `fallback` in production (sends the original and logs).
- **Docs (PLAN-38):** Swagger UI at `/docs` on the API server's loopback port only, so the client never sees it.
- **Lists (PLAN-31):** opt-in `paged=true` envelopes. Documents page by offset (the Pensieve merges kinds by per-kind offsets); Accio and Portkey page by keyset cursor (`400 BAD_CURSOR` on a bad one). Without `paged`, the legacy bare array is unchanged.
- **Raw documents:** `GET /<kind>/api/v1/:slug` serves stored text with CORS `*`, so a saved document is a stable data URL. Ids are 6-char base36; slugs `<kebab>-<id>`, a stale slug 301s.
- **Errors:** one envelope `{ error, message, details? }`.

## Key flows

- **Upload:** multipart streams to `storage/tmp/` → validated (size, sanitized name, extension blocklist) → linked into `storage/uploads/` → `bus.emit('file.uploaded')`. Mode 0644, never executed; `.html`/`.js`/`.svg` served as `text/plain`.
- **Downloads:** chokidar watches `storage/downloads/` at `depth: 1` (one folder level) → `download.added` → SSE to every client. Served through a controlled endpoint with realpath confinement; a folder streams as a zip (`archiver`).
- **Documents** (runestone, edda, groot, atlas): save → cap check (+ JSON/JSONC validation for runestone) → table → `bus.emit('<kind>.saved')` → SSE updates open libraries; audit-log records it.
- **Hand-offs between tools:** one-shot `sessionStorage` seeds (`core/*Seed.ts`).
- **Logging:** every line is pino JSON in `storage/logs/`; the browser's errors arrive through `client-logs`. `LOG_LEVEL` defaults to `trace`; filter in Grafana.
- **Metrics:** a snapshot log line per interval is the record; Prometheus and OTel traces (off by default) are optional.

## The CLI (PLAN-27)

`cli/` publishes a `bifrost` binary from a GitHub Release tarball: push/pull, clipboard, documents, go-links, presence, speed test. It is a **consumer only**: no server route exists for it alone.

- Uploads use `node:http` with a piped multipart body: `fetch` + `FormData` buffers the whole file.
- `bifrost.local` resolves through the OS (`getaddrinfo`); the default address falls back to `127.0.0.1:4646`, then `:4647`.
- A slug names a document but not its kind: `open`/`preview` ask all four raw endpoints and check the content type (an SPA fallback answers 200 with `index.html`).
- Only `update` and `doctor` touch the GitHub API.
- All terminal presentation is in `output.ts` (TTY-aware; `--json` turns it off).
- `scripts/cli-sync.ts` reinstalls the packed CLI globally on `build` and `start`.

## Testing layers

- **Unit and integration:** Vitest in every workspace.
- **`e2e/` (PLAN-32a, 33):** tests what ships, from outside, and imports no product source. Browser journeys (Playwright: Chromium desktop and mobile, WebKit mobile, standalone) through the web host, with a global guard failing on any page error, `console.error`, 5xx or non-loopback request; `routes.spec.ts` fails CI for a page with no journey. The installed CLI, and a black-box API suite (boot, transport, contract against `openapi.json`, fuzzing, security sweep).
- **Load (PLAN-34):** `./bifrost test load`, on demand, never CI.
- **Restart safety:** `./bifrost test resilience` (restarts, SIGKILL mid-write and mid-migration, `integrity_check`).

Detail: `docs/testing.md`.

## Restart safety

The server is stopped and started constantly.

- SQLite WAL, `synchronous=NORMAL`, `busy_timeout`.
- Graceful shutdown: stop accepting, abort uploads, close watchers and SSE, checkpoint.
- Aborted uploads leave junk only in `storage/tmp/`, swept on boot.
- The download listing is rebuilt from disk on boot; migrations are idempotent and tracked in the DB.

## Storage and operations

- `storage/{uploads,downloads,tmp,data,logs}` inside the repo, gitignored; paths from `.env`; `storage/data/app.db` is the database.
- Production entries are `server/src/bootstrap.ts` and `web/src/bootstrap.ts`.
- macOS runs native under PM2 or launchd (mDNS and FSEvents); Docker images per process (`docker/`, `compose/`) are for Linux and the standalone site. The web host may run in Docker on a Mac with a native mDNS advertiser.
- Backups: `core/backup` (online-safe snapshot, rotation), scheduled by a launchd agent into a cloud-synced folder; restore validates every entry and refuses a live server.
- Observability (optional): `compose/observability.yml` (Grafana, Loki, Alloy, Prometheus, Tempo); Alloy tails the log files.
- Releases: `.github/workflows/release.yml` on push to `main` bumps the version, tags, publishes a Release (server bundle + CLI tarball) and back-merges to `develop`.
