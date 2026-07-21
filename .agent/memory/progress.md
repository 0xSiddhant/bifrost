# Progress Tracker

Update after every work session: status, branch/PR, notes. Statuses: `not-started` · `in-progress` · `in-review` · `blocked` · `done`.

**Active plan: PLAN-09 (not started) — PLAN-08 merged & archived**

| Plan    | Title                                              | Status         | Branch / PR                                   | Notes                                                                                           |
| ------- | -------------------------------------------------- | -------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| PLAN-00 | Foundation (tech setup, zero feature code)         | done           | main (direct, per plan)                       | Pushed 2026-07-12; develop created                                                              |
| PLAN-01 | UI/UX foundation ⛔ approval gate                  | done           | PR #2 → develop (merged 2026-07-13)           | **UI approved by owner 2026-07-13**; gate cleared — PLAN-02 unlocked                            |
| PLAN-02 | File transfer (upload + download + live watch)     | done           | PR #3 → develop (merged 2026-07-14)           | Owner tested locally; CI green — PLAN-03 unlocked                                               |
| PLAN-03 | Previews + QR tool                                 | done           | PR #4 → develop (merged)                      | Merge confirmed in git history 2026-07-16                                                       |
| PLAN-04 | Theming engine                                     | done           | PR #5 → develop (merged 2026-07-15)           | Gate cleared — PLAN-05 unlocked                                                                 |
| PLAN-05 | Heimdall admin panel                               | done           | PR #6 → develop (merged 2026-07-16)           | Gate cleared — PLAN-06 unlocked                                                                 |
| PLAN-06 | Clipboard sync, presence, audit log                | done           | PR #7 → develop (merged 2026-07-16)           | Gate cleared — PLAN-07 unlocked                                                                 |
| PLAN-07 | Runestone (JSON editor Part A + library Part B)    | done           | PR #14 + PR #15 → develop (merged 2026-07-19) | Both parts owner-tested; CI green. Plan archived to `completed/`                                |
| PLAN-08 | Variant (JSON & text diff checker)                 | done           | PR #17 → develop (merged)                     | Owner-tested; merged 2026-07-20. Plan archived to `completed/`. Gate cleared — PLAN-09 unlocked |
| PLAN-09 | Ops (PM2, backup, Docker, observability)           | in-progress    | feat/plan-09-ops (draft PR)                    | Tranche 1 done: backup/restore, resilience suite, PM2, launchd. Remaining: Docker, observability, cloud doc, release automation + CI |
| PLAN-10 | Heimdall Modal (overlay conversion + new sections) | not-started    | —                                             | Plan authored 2026-07-16; supersedes "PIN on every arrival" (logged when implemented)           |
| PLAN-11 | Edda (markdown editor + preview + library)         | not-started    | —                                             | Plan authored 2026-07-21                                                                        |
| PLAN-99 | Future backlog                                     | reference-only | —                                             | Never "implemented" wholesale                                                                   |

## Recent activity (newest first)

One line per session; **full detail — test evidence, live-verify runs, deviations — lives in [`history.md`](history.md)**.

- 2026-07-21 — **PLAN-09 (Ops) tranche 1** on `feat/plan-09-ops` (draft PR): online-safe **backup/restore** (`core/backup` VACUUM INTO + zip storage/+themes/, rotation, `--include-env`; restore refuses a live server; thin CLI wrappers; 18 tests + real round-trip), scripted **restart-resilience suite** (`npm run test:resilience` — 50 SIGINT cycles + SIGKILL mid-write/mid-migration + tmp-sweep, all integrity-ok; full 50-cycle run green), **PM2** (`ecosystem.config.cjs` + `docs/pm2.md`) and **launchd** (`docs/launchd.md`). Added `BACKUP_KEEP`, `ops` commitlint scope, `*.cjs` eslint block. Remaining (tranche 2, needs owner hardware/secrets): Docker + observability + cloud-profile doc + release automation + CI docker job.
- 2026-07-21 — **PLAN-11 (Edda)** authored: markdown editor (shared CM6 editor gains markdown mode) + perf-budgeted live preview (debounce+rAF, manual-mode degradation over EDDA_LIVE_PREVIEW_MAX_KB, mobile unmounts preview), own `eddas` table/library, three share surfaces (`/edda/:slug` editor · `/edda/preview/:slug` public render · `/edda/api/:slug` raw+download), toolbar/outline/scroll-sync/stats/exports, coming-soon footer. Mermaid/image-paste/PDF parked in PLAN-99.
- 2026-07-21 — Variant invalid-JSON fix: a failed JSON Compare now stays in JSON mode and warns instead of switching to Text and clobbering the text workspace. Live-verified. Also on this branch: context/docs sync, this memory restructure, and two lore renames — **Muninn → Hermes** (`/hermes`, `features/hermes/HermesPage`) and **Mímir → Pensieve** (`/runestone/pensieve`, `PensievePage`); old routes 301-redirect; server module ids (`clipboard`, `runestone`) unchanged. Branch `fix/variant-invalid-json-preserves-text`.
- 2026-07-20 — **PLAN-08 (Variant)** implemented + 4 owner-feedback rounds → merged (PR #17): structural JSON diff + text fallback, editable panes in both modes, JSON/text as separate workspaces, diff-only-on-Compare, and perf caps for large docs. `--diff-*` theme tokens added.
- 2026-07-19 — **PLAN-07 (Runestone)** Part A + B merged (PR #14/#15) + addendum: public data endpoint `GET /runestone/api/:slug`, library renamed **Mímir**. Greek names added to the runestone name-bank.
- 2026-07-18 — Olympus world: `themes/olympus.json` built-in, `greek.tsx` relics 14→20, GREEK character pool.
- 2026-07-16 — **v1.0.0 released** (plans 00–06 archived). **PLAN-06** clipboard/presence/audit-log + device character aliases; Muninn link detection.
- 2026-07-15 — **PLAN-04** theming engine + **PLAN-05** Heimdall admin (auth core service, hidden gesture/PIN). Ghibli Dusk theme + theme enable/disable.
- 2026-07-12→14 — **PLAN-00** foundation, **PLAN-01** UI/UX (owner-approved), **PLAN-02** file transfer, **PLAN-03** previews + QR.
