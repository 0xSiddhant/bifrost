# Progress Tracker

Update after every work session: status, branch/PR, notes. Statuses: `not-started` · `in-progress` · `in-review` · `blocked` · `done`.

**Active plan: PLAN-09 (not started) — PLAN-08 merged & archived**

| Plan | Title | Status | Branch / PR | Notes |
|---|---|---|---|---|
| PLAN-00 | Foundation (tech setup, zero feature code) | done | main (direct, per plan) | Pushed 2026-07-12; develop created |
| PLAN-01 | UI/UX foundation ⛔ approval gate | done | PR #2 → develop (merged 2026-07-13) | **UI approved by owner 2026-07-13**; gate cleared — PLAN-02 unlocked |
| PLAN-02 | File transfer (upload + download + live watch) | done | PR #3 → develop (merged 2026-07-14) | Owner tested locally; CI green — PLAN-03 unlocked |
| PLAN-03 | Previews + QR tool | done | PR #4 → develop (merged) | Merge confirmed in git history 2026-07-16 |
| PLAN-04 | Theming engine | done | PR #5 → develop (merged 2026-07-15) | Gate cleared — PLAN-05 unlocked |
| PLAN-05 | Heimdall admin panel | done | PR #6 → develop (merged 2026-07-16) | Gate cleared — PLAN-06 unlocked |
| PLAN-06 | Clipboard sync, presence, audit log | done | PR #7 → develop (merged 2026-07-16) | Gate cleared — PLAN-07 unlocked |
| PLAN-07 | Runestone (JSON editor Part A + library Part B) | done | PR #14 + PR #15 → develop (merged 2026-07-19) | Both parts owner-tested; CI green. Plan archived to `completed/` |
| PLAN-08 | Variant (JSON & text diff checker) | done | PR #17 → develop (merged) | Owner-tested; merged 2026-07-20. Plan archived to `completed/`. Gate cleared — PLAN-09 unlocked |
| PLAN-09 | Ops (PM2, backup, Docker, observability) | not-started | — | Renumbered from PLAN-07 on 2026-07-14 |
| PLAN-10 | Heimdall Modal (overlay conversion + new sections) | not-started | — | Plan authored 2026-07-16; supersedes "PIN on every arrival" (logged when implemented) |
| PLAN-99 | Future backlog | reference-only | — | Never "implemented" wholesale |

## Recent activity (newest first)

One line per session; **full detail — test evidence, live-verify runs, deviations — lives in [`history.md`](history.md)**.

- 2026-07-21 — Variant invalid-JSON fix: a failed JSON Compare now stays in JSON mode and warns instead of switching to Text and clobbering the text workspace. Live-verified. Branch `fix/variant-invalid-json-preserves-text` (this branch also carries a context/docs sync + this memory restructure).
- 2026-07-20 — **PLAN-08 (Variant)** implemented + 4 owner-feedback rounds → merged (PR #17): structural JSON diff + text fallback, editable panes in both modes, JSON/text as separate workspaces, diff-only-on-Compare, and perf caps for large docs. `--diff-*` theme tokens added.
- 2026-07-19 — **PLAN-07 (Runestone)** Part A + B merged (PR #14/#15) + addendum: public data endpoint `GET /runestone/api/:slug`, library renamed **Mímir**. Greek names added to the runestone name-bank.
- 2026-07-18 — Olympus world: `themes/olympus.json` built-in, `greek.tsx` relics 14→20, GREEK character pool.
- 2026-07-16 — **v1.0.0 released** (plans 00–06 archived). **PLAN-06** clipboard/presence/audit-log + device character aliases; Muninn link detection.
- 2026-07-15 — **PLAN-04** theming engine + **PLAN-05** Heimdall admin (auth core service, hidden gesture/PIN). Ghibli Dusk theme + theme enable/disable.
- 2026-07-12→14 — **PLAN-00** foundation, **PLAN-01** UI/UX (owner-approved), **PLAN-02** file transfer, **PLAN-03** previews + QR.
