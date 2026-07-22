# Tech Stack (decided — do not swap without a logged decision)

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js ≥ 20, TypeScript strict | Owner's existing Node/mDNS/WebSocket experience; typed contracts for themes/config/API |
| HTTP server | Fastify 5 | Plugin encapsulation maps to feature modules; built-in schema validation; first-class streaming; pino-native |
| Frontend | React 19 + Vite, vertical-slice `features/` folders, route-level code splitting | Dynamic theming, admin forms, live lists need components; splitting keeps cloud builds free of local-only UI (was React 18 at planning time — see decision log 2026-07-12) |
| Styling | Plain CSS + CSS custom properties (no Tailwind) | Themes are JSON → CSS variables on `:root`; hot-swappable, framework-agnostic |
| DB | better-sqlite3 + Drizzle ORM, WAL mode | Embedded single file, zero babysitting, restart-tolerant; Drizzle gives typed schema + migrations; repository interfaces keep Postgres swap mechanical for cloud profile |
| Uploads | @fastify/multipart (busboy) | Streams to disk, flat memory at 2 GB; temp-file + atomic rename |
| File watching | chokidar (`awaitWriteFinish` on) | FSEvents-native on macOS; debounces half-copied files; used by VS Code/webpack |
| Live updates | Server-Sent Events (one hub) | One-directional notifications; browser auto-reconnect; ~20 lines vs WS lifecycle management |
| mDNS | bonjour-service | Advertise `bifrost.local`; Android fallback = LAN-IP QR code printed at boot + shown in Heimdall |
| Config | dotenv + zod validation at boot | Fail fast on bad env; `.env` = defaults + secrets, DB `settings` table = runtime-mutable values (admin shortcut, etc.) |
| Logging | pino → JSON file (`storage/logs/`) + pino-roll rotation; pino-pretty in dev | Structured lines per module/request; the optional observability stack tails these files |
| Admin sessions | @fastify/secure-session (stateless secretbox cookie) + revocable session epoch in DB settings | No server-side session store to babysit; epoch bump = revoke-all that survives restart (see decisions 2026-07-15) |
| Device labels | ua-parser-js (server-side) | Presence turns UAs into "iPhone · Safari" labels; character aliases layered on top (PLAN-06) |
| Theme validation | ajv against a published JSON Schema | Users add themes as JSON; schema is the contract (THEME-SPEC.md) |
| JSON editor & tooling (client) | CodeMirror 6 (`@codemirror/*`, incl. `merge` for diff chunking and `search` for in-editor find) + jsonc-parser | Runestone/Variant need a real code editor (lint, fold, highlight, auto-close, find); jsonc-parser gives token-preserving format/minify that keeps > 2^53 precision. Shared `core/ui/JsonEditor` mounts in both features (PLAN-07/08); its find + Variant cross-pane reveal is shared so Edda (PLAN-11) inherits it |
| Lint/format | ESLint + eslint-plugin-boundaries + Prettier | Boundaries plugin mechanically enforces module isolation |
| Commits | commitlint + husky, Conventional Commits | Owner's established discipline; scopes = module names |
| Tests | Vitest (+ supertest via fastify.inject) | Fast, TS-native, same tool front+back |
| Process manager (macOS run mode) | PM2 or launchd | Native run keeps mDNS/FSEvents working. Both crash-restart + start-on-boot; PM2 adds live monitoring, launchd needs no install. `ecosystem.config.cjs` + one-command `scripts/start-pm2.sh` / `start-launchd.sh`; runs `server/dist/bootstrap.js` (app.ts's direct-run guard doesn't fire under PM2's fork wrapper) — see docs/pm2.md, docs/launchd.md |
| Docker (Linux target) | Multi-stage Dockerfile + compose | NOT the macOS run mode (mDNS/FSEvents/Finder break in the Docker VM). Ships for a future Linux host (`--network host`); CI builds it every PR to keep it honest — docs/docker-linux.md |
| Observability (optional) | Grafana + Loki + Alloy (`docker-compose.observability.yml`) | Alloy tails `storage/logs/*.log` → Loki → Grafana; files-first so it's fully detachable and backfills. Works alongside any run mode — docs/observability.md |
| Backup/restore | better-sqlite3 `VACUUM INTO` + `zip`/`unzip` | Online-safe DB snapshot (consistent under WAL) + archive of `storage/` + `themes/`; `core/backup` reused in-process by PLAN-10's button — docs/releasing.md for state boundaries |
| Release automation | GitHub Actions (`release.yml`) + changelogen | On push to `main`: semver from conventional commits → bump + CHANGELOG → tag → GitHub Release + tarball → `main`→`develop` back-merge; needs a `RELEASE_TOKEN` PAT — docs/releasing.md |

PWA: static `web app manifest` + icons in `client/public/` (favicon SVG + PNG fallbacks, `apple-touch-icon`, 192/512 "any" + maskable icons) — no service worker (LAN app, no offline story needed). Vite copies `public/` to the dist root; `@fastify/static` serves it (manifest as `application/manifest+json`). Brand mark = the Bifrost rainbow bridge (Aurora `--bridge` teal→violet→green arch on `#0b0e14`).

Deferred/optional: Postgres (cloud profile), PWA service worker / offline caching.
