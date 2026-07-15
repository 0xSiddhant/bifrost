# Progress Tracker

Update after every work session: status, branch/PR, notes. Statuses: `not-started` · `in-progress` · `in-review` · `blocked` · `done`.

**Active plan: PLAN-03**

| Plan | Title | Status | Branch / PR | Notes |
|---|---|---|---|---|
| PLAN-00 | Foundation (tech setup, zero feature code) | done | main (direct, per plan) | Pushed 2026-07-12; develop created |
| PLAN-01 | UI/UX foundation ⛔ approval gate | done | PR #2 → develop (merged 2026-07-13) | **UI approved by owner 2026-07-13**; gate cleared — PLAN-02 unlocked |
| PLAN-02 | File transfer (upload + download + live watch) | done | PR #3 → develop (merged 2026-07-14) | Owner tested locally; CI green — PLAN-03 unlocked |
| PLAN-03 | Previews + QR tool | in-review | feat/plan-03-previews-qr (local) | Implemented + verified 2026-07-14; awaiting owner testing, then push + PR |
| PLAN-04 | Theming engine | in-review | feat/plan-04-theming (local) | Implemented + verified 2026-07-15; awaiting owner testing, then push + PR |
| PLAN-05 | Heimdall admin panel | not-started | — | |
| PLAN-06 | Clipboard sync, presence, audit log | not-started | — | |
| PLAN-07 | Runestone (JSON editor Part A + library Part B) | not-started | — | Two PRs (07a, 07b) per plan's declared exception |
| PLAN-08 | JSON Differ | not-started | — | Plan file to be authored (owner); shares PLAN-07 components |
| PLAN-09 | Ops (PM2, backup, Docker, observability) | not-started | — | Renumbered from PLAN-07 on 2026-07-14 |
| PLAN-99 | Future backlog | reference-only | — | Never "implemented" wholesale |

## Session notes (append newest first)

- 2026-07-15 — PLAN-04 implemented: `themes` module both profiles (draft-2020-12 schema + ajv all-errors validation, fs store + chokidar watcher with silent boot scan, derived-defaults resolver so a 14-color theme themes everything, contrast lint warn-only, routes GET/POST/DELETE with `THEME_WRITE_API` flag until PLAN-05 auth); built-ins rewritten as `themes/aurora.json`/`daybreak.json`; `--syn-*` tokens added; client engine (fetch → inline `:root` vars → localStorage cache, FOUC inline script in index.html, SSE `theme.updated` live refresh, pure `resolveThemeChoice` resolution) + ThemeSwitcher dropdown replacing ThemeToggle; client workspace gained vitest. 117 server + 6 client tests green. Live-verified: watcher pickup 483 ms, invalid file skipped, 422 ajv paths, 403 built-in delete, SSE frames. docs/THEME-SPEC.md written. Awaiting owner browser pass; not pushed.

- 2026-07-14 (later) — PLAN-03 implemented: core range parser (single-range, 206/416) + inline mime map + shared download-id; file-transfer content route gained Range/`?inline=1`; `previews` module (file-type sniffing, kind resolver, `GET /api/downloads/:id/meta`, local profile); `qr-tool` module (`GET /api/qr/server-url`, boot-log ASCII QR, both profiles). Client: preview modal route `/downloads/:id/preview` (image/video/audio/pdf/markdown/text viewers, esc/arrow nav), downloads preview affordance, shared `<QrCard>` + live QR page. 94 tests green. Verified live: iOS-style `bytes=0-1` probe → 206, mid-file seek, suffix, 416; lying `.txt`-with-png-bytes → kind image; zip → download-only; deep link serves SPA. Manual device pass (video scrub iOS/Android, pinch zoom, PDF) still owed. Awaiting owner testing; not pushed.

- 2026-07-14 — PLAN-02 implemented end-to-end: server `file-transfer` module (sanitizer, upload/list/stream usecases, fs repo, chokidar watcher, multipart+rate-limited routes, bus→SSE wiring, manifest local-only), client upload queue (dropzone, per-file XHR progress/cancel/retry, pre-checks from `/api/files/config`) and live downloads list (SSE deltas + reconnect resync, search/sort). 51 tests green incl. sanitizer corpus, 429/413/traversal integration, watcher→SSE, SIGINT-mid-upload kill test. Verified against the real built server: 2.1 GB → clean 413, 1.9 GB → 201 at ~92 MB peak RSS, download.* events <2 s, rate limit 429 (probing found+fixed a 500-instead-of-429 bug in core/http). Stretch zip-archive endpoint deliberately not built. Awaiting owner testing; not pushed.

- 2026-07-13 — Round 4 (owner tweaks post-approval): faster relic drift, collision-free placement, third collection (Olympus/Greek, 14 relics), Heimdall "Sky relics" per-collection filter (localStorage, default all). DESIGN.md + decision log updated.
- 2026-07-13 — PLAN-01 built and iterated 3 rounds: (1) base system — fonts Option A, Aurora/Daybreak tokens, components, all static pages; (2) Norse-world immersion — aurora sky, realm eyebrows, portal glows; (3) random background relics (Norse + wizarding easter eggs, moved to client/src/assets/relics). **Owner approved the UI 2026-07-13.** Screenshot gallery artifact maintained across rounds. All gates green; awaiting commit + PR into develop.

- 2026-07-12 — PLAN-00 implemented end-to-end: workspaces, tooling, core kernel (config/logger/db/bus/sse/http/mdns/auth stub), module contract + manifest with `health` pseudo-module, client shell, scripts, CI, docs, tests (16 passing incl. SIGINT kill test). Verified: 10× restart loop clean, mDNS visible, boundaries lint fails on violations, commitlint rejects malformed messages. Deps refreshed to current stable (React 19 etc. — see decision log). Awaiting push approval; `develop` to be created after.
- 2026-07-12 — Repo planning completed; `.agent/` folder seeded. Nothing implemented yet.
