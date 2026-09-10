---
name: verify
description: Run Bifrost's full quality gate before any commit, PR, or when asked to "verify" the project state. Use after implementing any plan task, before raising a PR, and whenever build/test health is in question.
---

# Verify — Bifrost quality gate

Run these in order; stop at the first failure and report it with the failing output. Never raise a PR with any step red.

1. `npm run lint` — includes eslint-plugin-boundaries; a cross-module import is a failure, not a warning.
2. `npm run typecheck` — **all three workspaces** (server, client, cli). This is the step that catches what `npm test` cannot: **vitest does not typecheck**, so a green suite is never evidence the workspace compiles (hit for real in PLAN-25 and again in PLAN-27).
3. `npm test` — server + client + cli suites. The CLI's `*.int.test.ts` files spawn a **real** server per suite via `tsx`, so a failure there can be the server's rather than the CLI's; read which suite failed before assuming.
4. `npm run build` — client + server production build, then `scripts/cli-sync.ts` (builds `cli/`, and re-installs the global `bifrost` unless `CI` is set). A build failure attributed to "the CLI sync" is usually just `cli/`'s own `tsc`.
5. **Restart smoke** (only if the change touches server/storage/DB): start the built server, hit `/api/health`, SIGINT it, start again, hit `/api/health` again, then run `PRAGMA integrity_check` against `storage/data/app.db` — expect `ok`. For a deeper pass on storage-critical changes, run `npm run test:resilience` (50 restarts + SIGKILL mid-write/mid-migration + tmp-sweep, all integrity-checked); it is on-demand, not part of `npm test`.

6. **CLI touched?** If the change is in `cli/`, the browser half of `live-verify` proves nothing — verify the **globally installed** `bifrost` against the built server instead (`npm run build` installs it), and check both a TTY and a piped run: colour, symbols and progress bars must vanish when stdout/stderr is not a terminal, and `--json` must stay parseable through `jq`.

Report format: one line per step (✅/❌), then details only for failures. If a plan file defines extra acceptance criteria for the work in progress, list which ones are covered by tests vs. still manual.
