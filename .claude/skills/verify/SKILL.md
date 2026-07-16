---
name: verify
description: Run Bifrost's full quality gate before any commit, PR, or when asked to "verify" the project state. Use after implementing any plan task, before raising a PR, and whenever build/test health is in question.
---

# Verify — Bifrost quality gate

Run these in order; stop at the first failure and report it with the failing output. Never raise a PR with any step red.

1. `npm run lint` — includes eslint-plugin-boundaries; a cross-module import is a failure, not a warning.
2. `npm run typecheck` — both workspaces.
3. `npm test` — server + client suites.
4. `npm run build` — client + server production build.
5. **Restart smoke** (only if the change touches server/storage/DB): start the built server, hit `/api/health`, SIGINT it, start again, hit `/api/health` again, then run `PRAGMA integrity_check` against `storage/data/app.db` — expect `ok`.

Report format: one line per step (✅/❌), then details only for failures. If a plan file defines extra acceptance criteria for the work in progress, list which ones are covered by tests vs. still manual.
