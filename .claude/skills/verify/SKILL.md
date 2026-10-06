---
name: verify
description: Run Bifrost's full quality gate before any commit, PR, or when asked to "verify" the project state. Use after implementing any plan task, before raising a PR, and whenever build/test health is in question.
---

# Verify — Bifrost quality gate

Run these in order; stop at the first failure and report it with the failing output. Never raise a PR with any step red.

1. `npm run lint` — includes eslint-plugin-boundaries; a cross-module import is a failure, not a warning.
2. `npm run typecheck` — **all four workspaces** (server, client, cli, e2e). This is the step that catches what `npm test` cannot: **vitest does not typecheck**, so a green suite is never evidence the workspace compiles (hit for real in PLAN-25 and again in PLAN-27).
3. `npm test` — server + client + cli suites, plus the e2e workspace's unit tests of its own support code. The CLI's `*.int.test.ts` files spawn a **real** server per suite via `tsx`, so a failure there can be the server's rather than the CLI's; read which suite failed before assuming. Server tests run the response contract guard in `strict` mode, so a `CONTRACT_VIOLATION` names a route whose schema changed its bytes. A failing `openapi.test.ts` means `server/openapi.json` is stale: run `npm run api:spec` and commit the result (PLAN-32b).
4. `npm run build` — client + server production build, then `scripts/cli-sync.ts` (builds `cli/`, and re-installs the global `bifrost` unless `CI` is set). A build failure attributed to "the CLI sync" is usually just `cli/`'s own `tsc`.
5. `npm run test:e2e` (steps 1–5 in one go: `npm run test:all`) — the end-to-end safety net (PLAN-32a) against the build from step 4: the installed-CLI suite, then every browser journey in Chromium desktop, Chromium mobile and WebKit, plus the cloud project. Needs Playwright's browsers once per version (`cd e2e && npx playwright install chromium webkit`). A failure is a client break caught before merge, never a flake to re-run: read the trace (`npx playwright show-trace e2e/test-results/<test>/trace.zip`) and the attached server output. Where a failure is a *known* bug pinned with `test.fail`, the pin flipping red means the bug was fixed — remove the pin. Full detail: `docs/testing.md`.

6. **Restart smoke** (only if the change touches server/storage/DB): start the built server, hit `/api/health`, SIGINT it, start again, hit `/api/health` again, then run `PRAGMA integrity_check` against `storage/data/app.db` — expect `ok`. For a deeper pass on storage-critical changes, run `npm run test:resilience` (50 restarts + SIGKILL mid-write/mid-migration + tmp-sweep, all integrity-checked); it is on-demand, not part of `npm test`.

7. **CLI touched?** If the change is in `cli/`, the browser half of `live-verify` proves nothing — verify the **globally installed** `bifrost` against the built server instead (`npm run build` installs it), and check both a TTY and a piped run: colour, symbols and progress bars must vanish when stdout/stderr is not a terminal, and `--json` must stay parseable through `jq`.

8. **A plan whose gate names the API diff** (PLAN-32b onward): `npm run test:api-diff -- --base develop` must report zero unexpected differences. It is not part of every verify — it builds a worktree and takes a minute or two — but it is part of every PR the plan says it guards.

Report format: one line per step (✅/❌), then details only for failures. If a plan file defines extra acceptance criteria for the work in progress, list which ones are covered by tests vs. still manual.
