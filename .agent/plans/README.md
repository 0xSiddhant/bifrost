# Bifrost Plans — Index & Gates

Implement strictly in order. One plan = one branch = one PR (except PLAN-00, see below). Each plan file follows the same format: goal → scope in/out → decisions & reasoning → task checklist → touched files → API contracts → acceptance criteria → test checklist.

| # | Plan | Gate to start |
|---|---|---|
| 00 | Foundation — all tech setup, zero feature code | User says "start plan 0". **Special: commits directly to `main`, each push only after user's manual approval. Creates `develop` at the end.** |
| 01 | UI/UX foundation — fonts, initial theme, design system, static pages | PLAN-00 done. **⛔ HARD GATE: user must explicitly approve the UI/UX before ANY plan below begins. Iterate until approved.** |
| 02 | File transfer — upload flow, download flow, live folder watch | PLAN-01 approved |
| 03 | Previews + QR tool | PLAN-02 merged |
| 04 | Theming engine (JSON themes) | PLAN-03 merged |
| 05 | Heimdall admin panel | PLAN-04 merged |
| 06 | Clipboard sync · device presence · audit log | PLAN-05 merged |
| 07 | Runestone — JSON viewer/editor (Part A) + saved library (Part B) | PLAN-06 merged. **Declared exception: two PRs** — `feat/plan-07a-runestone-editor`, then `feat/plan-07b-runestone-library` after A merges |
| 08 | Variant — JSON & text diff checker (shares PLAN-07's components) | PLAN-07 (both parts) merged |
| 09 | Ops — PM2, backup, Docker (Linux future), optional Grafana stack *(renumbered from 07)* | PLAN-08 merged |
| 99 | Future backlog | Reference only — pull items into new numbered plans when scheduled |

Rules of engagement: never start a gated plan early; never modify a plan file unprompted; deviations from a plan must be listed in the PR body and logged in `memory/decisions.md`.
