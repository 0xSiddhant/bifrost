# Bifrost Architecture

One Node/Fastify process serves the static frontend, REST API, and SSE stream on one port. No separate backend service, no reverse proxy.

## The three modularization rules (non-negotiable)

1. **Vertical slices.** Code is organized feature-first: `src/modules/<feature>/` contains that feature's routes, usecases, services, and DB schema. Shared infrastructure lives in `src/core/` only.
2. **Modules never import each other. Only `core`.** Cross-feature communication goes through the core **event bus** (e.g. `bus.emit('file.uploaded', meta)`). Enforced by `eslint-plugin-boundaries` — a violating import is a build failure, not a style nit.
3. **A deployment manifest decides what loads.** `DEPLOY_PROFILE=local|cloud` selects which modules the composition root registers. `local` = everything. `cloud` (future) = internet-safe modules only (currently qr-tool, themes, heimdall, runestone, variant — see `MANIFEST` in `server/src/app.ts`), Postgres instead of SQLite, no mDNS. The server exposes `GET /api/capabilities`; the frontend renders nav/pages from it — one client build serves both profiles.

## Layers inside every module

`route (HTTP concerns) → usecase (business rules) → service/repository (infrastructure)`.
Usecases depend on **repository interfaces**, never on Drizzle/fs/chokidar directly. Concrete implementations are injected by the module's `module.ts`. This is what makes the SQLite→Postgres swap mechanical later.

## Module registry

| Module | Purpose | Profile |
|---|---|---|
| `file-transfer` | Upload (write-only) + download (read-only) + live folder watch | local only |
| `previews` | In-browser image/PDF/video/markdown preview, range requests | local only |
| `clipboard` | Cross-device text/clipboard sync (Muninn page) | local only |
| `themes` | Theme engine, JSON themes, dynamic switching | both |
| `heimdall` | Hidden admin panel (gesture/shortcut + PIN) | both |
| `qr-tool` | QR generator utility + server-URL QR (Sigil page) | both |
| `presence` | Connected-device dashboard (Wardens page), character aliases + renames | local only |
| `audit-log` | Upload history & activity log (event-bus subscriber) | local only |
| `runestone` | JSON viewer/editor + saved document library (PLAN-07) | both |
| `variant` | JSON & text diff checker (PLAN-08) | both |

`variant` is **capability-only**: its `register()` is a deliberate no-op — all comparison runs client-side; the module exists purely so `/api/capabilities` advertises the page (and the Mímir picker's runestone-capability check). Runestone shares the JSON stack (`core/json`, `core/ui/JsonEditor`, `core/ui/TreeView`) that Variant mounts twice — those live in client `core/` because features may never import features.

## Core services (shared kernel — no feature imports)

`config` (zod-validated .env, overlaid with DB-stored runtime settings) · `db` (better-sqlite3 + Drizzle, WAL mode) · `logger` (pino, JSON file + rotation, child logger per module) · `event bus` (typed in-process emitter) · `sse-hub` (one SSE endpoint, all modules publish through the bus; carries per-connection metadata — deviceId/UA/IP — and an `onConnectionChange` subscription that presence consumes) · `auth` (`@fastify/secure-session` PIN sessions + revocable session epoch; decorates `app.requireAdmin`, which guards both Heimdall routes and theme write routes) · `mdns` (Bonjour advertisement, local profile only) · `http` (Fastify instance, static serving, error mapping).

## Key data flows

- **Upload:** client `POST /api/files` (multipart) → busboy streams to `storage/tmp/` → usecase validates (size limit from config, filename sanitization, extension blocklist) → atomic `rename()` into `storage/uploads/` → `bus.emit('file.uploaded')` → recorded twice, independently: heimdall's `upload_audit` (uploads metadata card) and audit-log's `audit_events` (cross-module history) — deliberately uncoupled tables. **No read route for `uploads/` exists anywhere.** Files written mode 0644, stored as `<timestamp>-<sanitized-name>`.
- **Live download:** file dropped into `storage/downloads/` via Finder → chokidar (FSEvents, `awaitWriteFinish`) → `bus.emit('download.added')` → sse-hub broadcasts → every open client updates. Downloads served via controlled endpoint with path-traversal protection, never a raw directory listing.
- **Runestone save:** editor `POST/PUT /api/runestone` → usecase validates (JSON parse, `RUNESTONE_MAX_DOC_KB` cap) → `runestones` table (id = 6-char handle anchoring the `<kebab-name>-<id>` slug; renames regenerate the slug, stale slugs 301) → `bus.emit('runestone.saved'|'runestone.deleted')` → SSE live-updates open libraries (the **Mímir** page); audit-log records both. Author stored as `author_device_id` only — names resolve client-side.
- **Runestone public data endpoint:** `GET /runestone/api/:slug` (outside `/api/`, wins over the SPA fallback) serves the **raw stored document text** as `application/json` with `Access-Control-Allow-Origin: *`, so a saved runestone doubles as a stable data URL for third-party tools. Stale slugs 301 to the canonical data URL; read-only — every write still goes through `/api/runestone`.

## Restart safety (server is stopped/started constantly)

- SQLite in **WAL mode**, `synchronous=NORMAL`, `busy_timeout` set; better-sqlite3 is synchronous so no half-finished async writes.
- Graceful shutdown on SIGINT/SIGTERM: stop accepting → drain/abort in-flight uploads → close chokidar, SSE, DB checkpoint → exit.
- Aborted uploads leave junk only in `storage/tmp/` — swept on boot.
- Boot reconciliation: chokidar initial scan rebuilds the download listing; audit tables reconciled against the folder.
- Drizzle migrations are idempotent and tracked in-DB.

## Storage layout

`storage/{uploads,downloads,tmp,data,logs}` inside the repo, gitignored (`.gitkeep` committed). Paths configurable via `.env`. `storage/data/app.db` is the SQLite file.
