# Bifrost Architecture

One Node/Fastify process serves the static frontend, REST API, and SSE stream on one port. No separate backend service, no reverse proxy.

## The three modularization rules (non-negotiable)

1. **Vertical slices.** Code is organized feature-first: `src/modules/<feature>/` contains that feature's routes, usecases, services, and DB schema. Shared infrastructure lives in `src/core/` only.
2. **Modules never import each other. Only `core`.** Cross-feature communication goes through the core **event bus** (e.g. `bus.emit('file.uploaded', meta)`). Enforced by `eslint-plugin-boundaries` — a violating import is a build failure, not a style nit.
3. **A deployment manifest decides what loads.** `DEPLOY_PROFILE=local|cloud` selects which modules the composition root registers. `local` = everything. `cloud` (future) = internet-safe modules only (currently qr-tool, themes, heimdall, runestone, variant — see `MANIFEST` in `server/src/app.ts`), Postgres instead of SQLite, no mDNS. The server exposes `GET /api/capabilities`; the frontend renders nav/pages from it — one client build serves both profiles. The nav groups pages into **three category hub tabs** (Midgard = transfer, Ollivanders = dev tools, Diagon Alley = utilities); each tool keeps its own route and is surfaced as a card on its hub, and a category tab shows only when one of its modules is in the capabilities list.

## Layers inside every module

`route (HTTP concerns) → usecase (business rules) → service/repository (infrastructure)`.
Usecases depend on **repository interfaces**, never on Drizzle/fs/chokidar directly. Concrete implementations are injected by the module's `module.ts`. This is what makes the SQLite→Postgres swap mechanical later.

## Module registry

| Module | Purpose | Profile |
|---|---|---|
| `file-transfer` | Upload (write-only) + download (read-only) + live folder watch | local only |
| `previews` | In-browser image/PDF/video/markdown preview, range requests | local only |
| `clipboard` | Cross-device text/clipboard sync (Hermes page) | local only |
| `themes` | Theme engine, JSON themes, dynamic switching | both |
| `heimdall` | Hidden admin panel (gesture/shortcut + PIN) | both |
| `qr-tool` | QR generator utility + server-URL QR (Sigil page) | both |
| `presence` | Connected-device dashboard (Wardens page), character aliases + renames | local only |
| `audit-log` | Upload history & activity log (event-bus subscriber) | local only |
| `runestone` | JSON viewer/editor + saved document library (PLAN-07) | both |
| `variant` | JSON & text diff checker (PLAN-08) | both |
| `edda` | Markdown editor + live preview + saved library (PLAN-11) | both |
| `accio` | Read-later / bookmark shelf, with best-effort page-title enrichment (PLAN-13) | local only |
| `nimbus` | LAN speed test — byte streamer, discarding upload sink, single-flight guard, per-device history (PLAN-14) | local only |
| `screensaver` | Idle particle-constellation overlay ("Nótt") — policy only; all rendering is client canvas, desktop-only | both |

`screensaver` is **policy-only** (like `variant` is capability-only): it owns no rendering — the overlay is a client `features/screensaver/` canvas mounted at the app root, gated to desktop pointers and shown after an idle timeout. The module exists to serve/persist the Heimdall-tunable settings (`GET /api/screensaver/config` public, admin `PATCH /api/screensaver/settings`, `screensaver.settingsUpdated` → SSE for live rebind), mirroring the Loki settings pattern.

`variant` is **capability-only**: its `register()` is a deliberate no-op — all comparison runs client-side; the module exists purely so `/api/capabilities` advertises the page (and the Pensieve picker's runestone-capability check). Runestone shares the JSON stack (`core/json`, `core/ui/JsonEditor`, `core/ui/TreeView`) that Variant mounts twice — those live in client `core/` because features may never import features.

## Core services (shared kernel — no feature imports)

`config` (zod-validated .env, overlaid with DB-stored runtime settings) · `db` (better-sqlite3 + Drizzle, WAL mode) · `logger` (pino, JSON file + rotation, child logger per module) · `event bus` (typed in-process emitter) · `sse-hub` (one SSE endpoint, all modules publish through the bus; carries per-connection metadata — deviceId/UA/IP — and an `onConnectionChange` subscription that presence consumes) · `auth` (`@fastify/secure-session` PIN sessions + revocable session epoch; decorates `app.requireAdmin`, which guards both Heimdall routes and theme write routes) · `mdns` (Bonjour advertisement, local profile only) · `http` (Fastify instance, static serving, error mapping) · `backup` (`VACUUM INTO` a consistent DB snapshot + zip of `storage/` + `themes/`, online-safe; importable so PLAN-10's in-app button reuses it).

## Key data flows

- **Upload:** client `POST /api/files` (multipart) → busboy streams to `storage/tmp/` → usecase validates (size limit from config, filename sanitization, extension blocklist) → atomic `rename()` into `storage/uploads/` → `bus.emit('file.uploaded')` → recorded twice, independently: heimdall's `upload_audit` (uploads metadata card) and audit-log's `audit_events` (cross-module history) — deliberately uncoupled tables. **No read route for `uploads/` exists anywhere.** Files written mode 0644, stored as `<timestamp>-<sanitized-name>`.
- **Live download:** file dropped into `storage/downloads/` via Finder → chokidar (FSEvents, `awaitWriteFinish`) → `bus.emit('download.added')` → sse-hub broadcasts → every open client updates. Downloads served via controlled endpoint with path-traversal protection, never a raw directory listing.
- **Runestone save:** editor `POST/PUT /api/runestone` → usecase validates (JSON parse, `RUNESTONE_MAX_DOC_KB` cap) → `runestones` table (id = 6-char handle anchoring the `<kebab-name>-<id>` slug; renames regenerate the slug, stale slugs 301) → `bus.emit('runestone.saved'|'runestone.deleted')` → SSE live-updates open libraries (the **Pensieve** page); audit-log records both. Author stored as `author_device_id` only — names resolve client-side.
- **Runestone public data endpoint:** `GET /runestone/api/:slug` (outside `/api/`, wins over the SPA fallback) serves the **raw stored document text** as `application/json` with `Access-Control-Allow-Origin: *`, so a saved runestone doubles as a stable data URL for third-party tools. Stale slugs 301 to the canonical data URL; read-only — every write still goes through `/api/runestone`.
- **Edda (Markdown) save + share:** editor `POST/PUT /api/edda` → usecase validates only the `EDDA_MAX_DOC_KB` cap (markdown is free text — no content validation, an empty doc is valid) → `eddas` table (same id/slug/301 scheme as runestone) → `bus.emit('edda.saved'|'edda.deleted')` → SSE live-updates open libraries; audit-log records both. Three share surfaces: `/edda/<slug>` (editor SPA route, opens Preview mode on mobile), `/edda/preview/<slug>` (public rendered SPA page), and `GET /edda/api/<slug>` — the raw stored Markdown as `text/markdown; charset=utf-8`, CORS `*`, outside `/api/` (wins over the SPA fallback), stale slugs 301, `?download=1` → attachment. Reserved first segments (`preview`, `api`, `library`) are guarded in slug resolution. The Markdown renderer (`client/core/markdown/renderMarkdown` — marked GFM + highlight.js + heading ids + DOMPurify) is one pure function shared by the live preview, the public page, and the HTML export.

- **Accio save + title enrichment:** shelf `POST /api/accio` → usecase validates and normalizes the URL (pure `modules/accio/url.ts`; **any scheme is a link** — `chrome://`, `about:`, `mailto:`, deeplinks — and only the ones that execute or embed inside a page are 422'd: `javascript:`, `data:`, `vbscript:`, `blob:`, `filesystem:`, since a stored row is rendered as an `href`) → `accio_links` table (6-char id, no slug — a link is never addressed by URL, the shelf is its only surface; `tags` is a JSON array) → `bus.emit('accio.saved')` → SSE, and audit-log records it. **The 201 never waits on the network.** The module (not the usecase) subscribes to `accio.saved` and, when the row has no title **and is an http(s) URL** (nothing else has a page to read), runs a detached best-effort lookup: `HttpTitleFetcher` GETs the page with a per-attempt timeout and a hard read cap (`ACCIO_TITLE_TIMEOUT_MS` / `ACCIO_TITLE_MAX_BYTES`), one retry, non-HTML and 4xx/5xx answered as "no title"; a hit patches the row and emits `accio.updated` → SSE, so open shelves fill the title in seconds. A user edit or delete during the flight wins — enrichment re-reads before writing. Shutdown awaits in-flight lookups. The client keeps the shelf live from these three events and filters/sorts locally (see decisions).

- **Nimbus (LAN speed test):** the measurement is split across both sides on purpose — the server moves bytes, the **client owns the clock**, because the number a person cares about is the one their own device sees. `GET /api/nimbus/ping` is a bodyless 204 (the client takes the median of ten, never the mean — one Wi-Fi retry would poison an average). `GET /api/nimbus/down?mb=` streams a window onto one pre-generated random pool (`services/payload-pool.ts`, 4 MiB, cycled by `chunkFrom`), pushed one chunk per `_read` so socket backpressure — not memory — paces it, with `content-encoding: identity` + `no-store` (a compressor anywhere on the path would invent throughput out of a repeating payload). `POST /api/nimbus/up` takes the **raw request stream in a custom `application/octet-stream` parser that counts and discards**: no file, no buffer, so "writes nothing to disk" is true by construction; over `NIMBUS_MAX_TEST_MB` it answers 413 from an `onRequest` hook, before reading a byte. A **single-flight `TestGuard`** (pure, clock-injected) holds a lease per device key across a test's several requests and frees it a grace period after the last one, so a second device gets 409 "another broom is flying" instead of two corrupted readings; `POST /api/nimbus/release` gives the lease back at once (the cancel path), and ping is deliberately ungated so a busy bridge stays reachable. Only a **complete** test is saved: `POST /api/nimbus/results` → `nimbus_results` (device-grouped history, pruned on the audit retention policy) → `bus.emit('nimbus.completed')` → SSE + audit.

## Restart safety (server is stopped/started constantly)

- SQLite in **WAL mode**, `synchronous=NORMAL`, `busy_timeout` set; better-sqlite3 is synchronous so no half-finished async writes.
- Graceful shutdown on SIGINT/SIGTERM: stop accepting → drain/abort in-flight uploads → close chokidar, SSE, DB checkpoint → exit.
- Aborted uploads leave junk only in `storage/tmp/` — swept on boot.
- Boot reconciliation: chokidar initial scan rebuilds the download listing; audit tables reconciled against the folder.
- Drizzle migrations are idempotent and tracked in-DB.
- Proven by `npm run test:resilience` (50 restarts + SIGKILL mid-write / mid-migration + tmp-sweep, all `integrity_check`ed).

## Storage layout

`storage/{uploads,downloads,tmp,data,logs}` inside the repo, gitignored (`.gitkeep` committed). Paths configurable via `.env`. `storage/data/app.db` is the SQLite file. `themes/` (user themes) is state outside `storage/`, so backups cover both.

## Operations & running (PLAN-09)

- **Production entry is `server/src/bootstrap.ts`**, not `app.ts`. `app.ts` self-starts only when it is the *direct* entry (`import.meta.url === argv[1]`); PM2's fork mode wraps the script so that guard never fires. `bootstrap.ts` calls `main()` unconditionally; `npm start`, PM2, launchd, and Docker all point at it. (`app.ts` keeps the guard so tests / the resilience suite can spawn it directly.)
- **Run modes:** macOS runs **native** (PM2 or launchd — mDNS + FSEvents need it) via `ecosystem.config.cjs` / a launchd plist, with one-command `scripts/start-*.sh`. **Docker targets a future Linux host** (`--network host`); it is deliberately not the macOS run mode.
- **Backup/restore:** `npm run backup` / `restore` wrap `core/backup` (online-safe snapshot, rotation, `--include-env` opt-in; restore refuses a live server).
- **Observability (optional, detachable):** `docker-compose.observability.yml` runs Grafana + Loki + Alloy; Alloy tails `storage/logs/*.log`, so it works with any run mode and backfills after downtime.
- **Releases are automated:** `.github/workflows/release.yml` on push to `main` computes the semver bump from conventional commits, tags, publishes a GitHub Release + tarball, and back-merges to `develop` (needs a `RELEASE_TOKEN` PAT).
