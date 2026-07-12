# Decision Log

Append-only. Never silently reverse a logged decision — add a new dated entry superseding it.

| Date | Decision | Reasoning (short) |
|---|---|---|
| 2026-07-12 | Project named **Bifrost**; admin panel named **Heimdall** | Rainbow bridge = transport between realms; Heimdall = gatekeeper |
| 2026-07-12 | Single Fastify process serves client + API + SSE | One URL on LAN, no CORS, one thing to start/stop |
| 2026-07-12 | Node 20 + TypeScript strict; Fastify over Express | Owner's Node experience; plugin encapsulation, validation, streaming |
| 2026-07-12 | React 18 + Vite; plain CSS with custom properties (no Tailwind) | Theming = JSON → CSS vars on `:root` |
| 2026-07-12 | SQLite (better-sqlite3 + Drizzle, WAL) now; repository interfaces so Postgres swap is mechanical for cloud profile ("Option A") | Embedded, restart-tolerant; don't build speculative dual-DB support |
| 2026-07-12 | SSE over WebSockets for live updates | One-directional notifications; browser auto-reconnect; far less lifecycle code |
| 2026-07-12 | chokidar with `awaitWriteFinish` for downloads/ watch | FSEvents-native; debounces half-copied files |
| 2026-07-12 | Uploads: busboy stream → tmp → atomic rename; 0644; no read route for uploads/ | Flat memory at 2 GB; crash-safe; write-only by construction |
| 2026-07-12 | Security: filename sanitization + extension blocklist ("both") | Belt-and-suspenders even though files are never executed/served |
| 2026-07-12 | Heimdall entry: hidden multi-tap AND keyboard shortcut (shortcut editable from admin, stored in DB) + PIN from .env → session cookie | Obscurity alone insufficient; DB stores runtime-mutable settings |
| 2026-07-12 | Admin sees upload **metadata only**; file management stays in Finder | Owner requirement |
| 2026-07-12 | Modularization: vertical slices, event-bus-only cross-module comms, DEPLOY_PROFILE manifest (local/cloud) | Some modules will go to the public internet later; upload/download never will |
| 2026-07-12 | pino → JSON files + rotation as baseline; Grafana+Loki as optional docker-compose add-on (PLAN-07), not load-bearing | Owner stops/starts constantly; observability stack must be detachable |
| 2026-07-12 | Docker is NOT the run mode on macOS (mDNS/FSEvents/Finder break in the VM); PM2 native instead; Dockerfile shipped for future Linux host | Portability story only |
| 2026-07-12 | UI must look unique — fonts + initial theme carefully chosen; **hard approval gate**: no feature plans implemented until user approves PLAN-01 UI/UX | Owner requirement |
| 2026-07-12 | Fonts self-hosted in repo (no font CDNs) | LAN may have no internet; offline-first |
| 2026-07-12 | PLAN-00 only: direct commits to `main` allowed after user's manual approval; `develop` created at its end; all later plans = PR into `develop` | Owner requirement |
| 2026-07-12 | Dependency versions refreshed to current stable at implementation time: React 19 + react-router 7 (supersedes "React 18" wording; our code is API-identical on both), Vite 8, Fastify 5.10, zod 4, pino 10, better-sqlite3 12, drizzle-orm 0.45. TypeScript held at 5.9 and ESLint at 9 — typescript-eslint 8 targets those; TS 7 / ESLint 10 revisit later as a logged decision | Ship on supported versions; avoid known CVEs in older pins |
| 2026-07-12 | eslint-plugin-boundaries v7 config uses the new `boundaries/dependencies` rule + `policies` + `{{from.element.captured.*}}` templates; composition-root files (`server/src/app.ts`, `client/src/main.tsx`) classified via `boundaries/files` categories (v7 elements match folders only). Legacy v5 syntax silently no-ops — enforcement verified empirically with violation probe files | The whole point is a build-failing boundary; a silently dead rule is worse than none |
| 2026-07-12 | Host runtime is Node 22 LTS via Homebrew (`node@22` linked as global node). The machine's Node 17 was broken irreparably by the icu4c upgrade during install | Project requires Node ≥ 20; 17 could not be restored (icu4c 69 gone from brew) |
| 2026-07-12 | Accepted npm audit residue: 4 moderate advisories, all the old esbuild bundled inside drizzle-kit (dev-only CLI; the advisory concerns esbuild's dev server, which we never run) | No runtime exposure; forcing the "fix" downgrades drizzle-kit to 0.18 |
