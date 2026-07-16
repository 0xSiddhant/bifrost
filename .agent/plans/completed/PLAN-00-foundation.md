# PLAN-00 — Foundation (all tech setup, zero feature code)

## Goal

A running skeleton: one Fastify process that boots cleanly, loads zero-or-more modules from a profile manifest, validates config, opens SQLite in WAL mode, logs to file, advertises over mDNS, serves an empty Vite/React client — plus all repo hygiene (lint, commit rules, CI, docs, scripts). **No feature module logic is written in this plan.**

## ⚠️ Special git rules — THIS PLAN ONLY

- Work happens as **direct commits to `main`** — the only plan ever allowed to do this.
- Commit in small logical chunks. **Before each push to `main`, present the changeset to the user and wait for explicit manual approval.** No approval, no push.
- Conventional Commits still apply (scope `core`, `client`, `ci`, `docs`, `chore`).
- Final task of this plan: create `develop` from `main` and push it. Every subsequent plan follows `.agent/rules/git.md` (feature branch → PR into `develop`).

## Scope

**In:** repo hygiene, tooling, CI, core kernel skeleton, module-loader contract, empty client shell, docs skeleton, npm scripts, storage bootstrap.
**Out:** any feature behavior (uploads, downloads, themes UI, admin). The only routes shipped: `GET /api/health`, `GET /api/capabilities`.

## Decisions & reasoning

- **Monorepo via npm workspaces** (`server/`, `client/`): one `npm install`, one version of TS/ESLint, shared scripts — no pnpm/turbo complexity for a two-package repo.
- **Module contract before modules exist:** `FeatureModule = { name, register(app, deps), migrations?, capabilities }`. The composition root proves the mechanism with a built-in `health` pseudo-module so PLAN-02+ only fill in slots.
- **Config precedence:** zod-parsed `.env` defaults → overlay of DB `settings` table (runtime-mutable values like Heimdall shortcut). `.env` can't be rewritten by the app; DB can.
- **GitHub Actions from day one** (answering "do I need it?": yes) — because every later plan lands via PR, and a PR without CI is a rubber stamp. Keep it cheap: lint, typecheck, test, build on PRs to `develop`/`main`.
- **Graceful shutdown wired now**, not later — dev watch mode restarts on every save, so the shutdown path gets exercised hundreds of times for free.

## Task checklist

**Repo & tooling**
- [ ] `package.json` workspaces (`server`, `client`); root scripts: `setup`, `dev`, `build`, `start`, `logs`, `backup`, `lint`, `typecheck`, `test`
- [ ] TypeScript strict configs (base + per-workspace); Prettier; ESLint flat config with `eslint-plugin-boundaries` rules: `core !→ modules`, `module !→ other module`
- [ ] husky + commitlint (Conventional Commits, scopes enum = module names + `core|client|ci|docs|chore`)
- [ ] `.gitignore`: `node_modules`, `dist`, `.env`, `storage/*` (keep `storage/**/.gitkeep`), `*.log`
- [ ] `.editorconfig`; MIT `LICENSE`
- [ ] `scripts/setup.ts`: create `storage/{uploads,downloads,tmp,data,logs}`, verify `.env` exists (copy from example if not), run migrations
- [ ] `scripts/backup.ts`: zip `storage/` → configurable `BACKUP_DIR`

**Env & config**
- [ ] `.env.example` with every key documented inline:
  `DEPLOY_PROFILE=local` · `PORT=4646` · `MDNS_NAME=bifrost` · `MAX_UPLOAD_SIZE_MB=2048` · `MAX_FILES_PER_UPLOAD=20` · `UPLOAD_EXT_BLOCKLIST=.exe,.bat,.cmd,.msi` (base set; belt-and-suspenders) · `STORAGE_ROOT=./storage` · `HEIMDALL_PIN=` (required, no default) · `HEIMDALL_SHORTCUT_DEFAULT=shift+meta+comma` · `HEIMDALL_TAP_COUNT=7` · `LOG_LEVEL=info` · `BACKUP_DIR=`
- [ ] `core/config`: zod schema, fail-fast boot error listing every invalid key; typed frozen export; `applySettingsOverlay(db)` hook

**Core kernel**
- [ ] `core/logger`: pino → `storage/logs/app.log` (pino-roll daily + 20MB), pretty transport in dev, `child({module})` helper
- [ ] `core/db`: better-sqlite3 open with `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`; Drizzle init; migration runner; `settings` table (key TEXT PK, value TEXT, updated_at)
- [ ] `core/bus`: typed EventEmitter wrapper; `events.ts` with empty union to be extended per module
- [ ] `core/sse`: `GET /api/events` endpoint, client registry, `broadcast(event, payload)`, heartbeat comment every 25s, clean close on shutdown
- [ ] `core/http`: Fastify factory (pino integration, sensible error handler, @fastify/static serving `client/dist` with SPA fallback)
- [ ] `core/mdns`: bonjour-service advertise `MDNS_NAME` on `PORT` when profile=local; on boot print all LAN IPv4 addresses + `http://<name>.local:<port>`
- [ ] `core/auth`: stub interfaces only (session plugin registered, no routes) — Heimdall fills in at PLAN-05
- [ ] Graceful shutdown: SIGINT/SIGTERM → fastify.close → watcher/SSE/DB close hooks → tmp sweep on next boot

**Composition root & contract**
- [ ] `app.ts`: profile manifest `{ local: [...], cloud: [...] }`; loads modules, aggregates capabilities
- [ ] `GET /api/health` → `{ ok, uptime, profile }`; `GET /api/capabilities` → `{ profile, modules: string[] }`

**Client shell**
- [ ] Vite + React TS scaffold; router; capabilities fetch → nav placeholder; SSE client util with reconnect; CSS variable groundwork (`tokens.css` with placeholder values — real design lands in PLAN-01)

**CI & docs**
- [ ] `.github/workflows/ci.yml` (basic): on PR to `develop`/`main` and push to `main` → checkout, setup-node 20 + cache, `npm ci`, lint, typecheck, test, build
- [ ] `docs/ARCHITECTURE.md` (mirror of context file), `docs/THEME-SPEC.md` placeholder, `docs/assets/` with placeholder demo.png
- [ ] Verify README instructions actually work end-to-end

**Finish**
- [ ] Create + push `develop`; update `memory/progress.md`

## Acceptance criteria

1. `npm install && npm run setup && npm run dev` boots with zero errors on a clean clone; terminal shows LAN IPs + `bifrost.local` URL.
2. `/api/health` and `/api/capabilities` respond; client shell loads from another device on the LAN via `bifrost.local` (Apple device) and via LAN IP (any device).
3. Killing the server (Ctrl-C) mid-run and restarting 10× in a row: no DB errors, no orphaned state, logs show clean shutdown sequence.
4. A commit with a malformed message is rejected locally; an import from one module folder into another fails lint.
5. CI is green on `main`; `develop` branch exists.

## Test checklist

- [ ] Unit: config schema (bad values fail with named keys), settings overlay precedence, filename of log rotation
- [ ] Integration: boot → health → capabilities via `fastify.inject`
- [ ] Kill test: SIGINT during idle + during an open SSE connection → clean exit code, WAL intact on reopen
