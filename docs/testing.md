# Testing Bifrost

Every kind of test this repo runs, how to run and replay each one, and which of them are permanent. `.agents/rules/coding.md` says what each change must ship; this page says how to run what is already here.

**One command runs them all:** `npm run test:all`. It runs lint → typecheck → `npm test` → build → `test:e2e`, stopping at the first failure: the same gate as CI and the `verify` skill. Use the narrower commands below to run or replay one slice.

**Why tests live in more than one place.** Unit and integration tests sit beside the code they test, in `server/`, `client/` and `cli/`. They import that code directly, run without a build, and come first in CI because they are fast. End-to-end tests live in `e2e/` and are _forbidden_ from importing product code: that rule is what proves they test what actually ships. Merging the two would lose that guarantee.

| Kind                       | Where                                                                 | Command                                 | Needs a build?     | In CI                  |
| -------------------------- | --------------------------------------------------------------------- | --------------------------------------- | ------------------ | ---------------------- |
| Unit + integration         | `server/`, `client/`, `cli/` (`*.test.ts`), plus the e2e support code | `npm test`                              | no                 | yes, before Build      |
| API description is current | `server/openapi.json` (checked by `openapi.test.ts` in `npm test`)    | `npm run api:spec` regenerates it       | no                 | yes, in `npm test`     |
| End-to-end: browser        | `e2e/browser/`, `e2e/cloud/` (Playwright)                             | `npm run test:e2e:ui -w e2e`            | yes                | yes, after Build       |
| End-to-end: installed CLI  | `e2e/cli/` (Vitest, `*.e2e.ts`)                                       | `npm run test:e2e:cli -w e2e`           | yes                | yes, after Build       |
| Both of the above          |                                                                       | `npm run test:e2e`                      | yes                | yes                    |
| Old-vs-new API diff        | `e2e/api-diff/`                                                       | `npm run test:api-diff -- --base <ref>` | this checkout, yes | no (a plan's gate run) |
| Restart resilience         | `scripts/resilience.ts`                                               | `npm run test:resilience`               | no                 | no (on demand)         |
| Live verification          | `.claude/skills/live-verify`                                          | the skill                               | yes                | no (manual)            |

## Unit and integration tests

`npm test` runs every workspace's Vitest suite. Server routes are tested with `fastify.inject`; the CLI's `*.int.test.ts` files spawn a real server from source through `tsx`. None of them needs `dist/`, which is why CI runs them before the build.

A server test builds its app with `createTestApp(overrides)` (`server/src/testing/app.ts`): the four required keys, a fresh temp storage root, a silent logger and the response contract guard in **strict** mode. Pass only the keys the suite cares about; pass `STORAGE_ROOT` yourself to seed files before boot or to restart over the same data.

## Response contracts and the API description (PLAN-32b)

A route's response schema is compiled into its serializer, so a wrong one changes what a client receives without failing anything. Three checks keep schemas honest:

- **The contract guard in strict mode** runs in every server test and every e2e server. A response whose serialized bytes differ from `JSON.stringify` of what the handler returned, a payload that fails the schema, or a status the route does not declare becomes `500 CONTRACT_VIOLATION` and names the route and the JSON pointer. `core/http/contract.test.ts` proves it catches each way a schema rewrites bytes: a dropped field, `null` → `""`/`0`, an emptied object, coercion, key order and an undeclared status.
- **`server/src/openapi.test.ts`** fails when the committed `server/openapi.json` is stale (`info.version` is ignored) and validates it as OpenAPI 3.1. Fix it with `npm run api:spec`.
- **`server/src/api-coverage.test.ts`** fails for any route without `tags`, a `summary`, a unique `operationId`, a success entry, a `400` entry where a request schema exists, or with `security` that does not match `requireAdmin`. Until PLAN-32c, `api-coverage.pending.ts` lists the routes not yet described; it can only shrink.

## The end-to-end safety net (PLAN-32a)

`e2e/` is the fourth npm workspace. It only ever sees the **built** system, from outside:

- the server through its production entry, `node --import server/dist/otel.js server/dist/bootstrap.js`;
- the client as that server serves `client/dist`, in real browsers;
- the CLI as a packed tarball, installed with `npm install -g --prefix <temp>`.

An eslint rule bans any import of `server/src`, `client/src` or `cli/src` from `e2e/`. A test that imported product source would test the source, not what ships.

### Running it

```bash
npm run build                                  # the e2e suites run against dist/
cd e2e && npx playwright install chromium webkit && cd ..   # once per Playwright version
npm run test:e2e                               # CLI suite, then the browser suite
```

Narrower runs, from `e2e/`:

```bash
npx playwright test browser/documents.spec.ts --project chromium-desktop
npx playwright test -g "Pensieve"              # by title
npx vitest run --config vitest.e2e.config.ts cli/transfer.e2e.ts
npx playwright show-trace test-results/<test>/trace.zip   # replay a failure step by step
```

A failing Playwright test keeps its trace, a screenshot, and the output of the server it ran against (`server-output` in the report). In CI the report and `test-results/` are uploaded as the `playwright-report` artifact.

Where Playwright's own browser download is unavailable but a Chromium is installed, `E2E_CHROMIUM_EXECUTABLE=/path/to/chrome` points the Chromium projects at it. WebKit has no such fallback.

### Projects

| Project            | What                                             | Why                                                                                    |
| ------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `chromium-desktop` | 1280×900                                         | the Mac on the desk                                                                    |
| `chromium-mobile`  | Pixel 7, 390×844, touch                          | phones, and the layouts below 640/768px                                                |
| `webkit-mobile`    | iPhone 14                                        | the household's iPads and iPhones are WebKit, and Safari-only bugs have shipped before |
| `cloud`            | Chromium against a `DEPLOY_PROFILE=cloud` server | the deployment manifest, seen from outside                                             |

### Isolation

Each Playwright worker and each Vitest e2e file starts **its own server** on a free port, with:

- a fresh `mkdtemp` storage root and a scratch copy of `themes/` (`THEMES_DIR` defaults to the repo's own folder, which a theme journey would otherwise edit);
- every key in `.env.example` and in your own `.env` blanked to its built-in default. The server's dotenv never overrides a set key, so without this a developer's real `.env` would leak into the suite;
- `NODE_ENV=production`, `OTEL_ENABLED=false`, a fixed test PIN, and a unique `MDNS_NAME` per port, so a run on the host Mac never advertises a second `bifrost.local` on the LAN.

A test that changes process-wide state (stopping the server, revoking every session, changing a policy, or needing exact counts) asks for `ownServer()`, a test-scoped server of its own.

The CLI suite and the cross-surface journeys install the packed CLI once per run into a temporary prefix, and run it with a temporary `HOME` and `XDG_CONFIG_HOME`. Your real `bifrost` and its config are never touched. The update-check cache is pre-seeded as fresh, so `doctor` never reaches GitHub.

Nothing touches `storage/`, a running instance, or the backup agent's paths. Every scratch folder is removed when its server stops.

### The no-silent-errors guard

Every browser context a test touches is guarded (`e2e/support/guards.ts`). A test **fails** on:

- a page error;
- a `console.error`;
- a response ≥ 500;
- a failed request;
- any request to a non-loopback host, which is also blocked. Fonts and assets are self-hosted, so an external request is a bug or a leak.

The exceptions are an explicit allowlist, each with its reason:

- the SSE stream cancelled by a navigation;
- a request the page aborted itself;
- the browser's own console line for a 4xx answer;
- connection-refused noise, but only after a test calls `guard.allowConnectionLoss()` because it stopped the server on purpose.
- WebKit's report of a same-origin request cut off by a navigation (`Fetch API cannot load … due to access control checks`, `Importing a module script failed`), but only when that page starts a navigation or closes within 3 seconds of it. Chromium drops such a request silently. The same words with no navigation nearby still fail the test.

`browser/guard.spec.ts` proves the guard still fires for each kind.

### Coverage cannot rot

`browser/routes.spec.ts` reads `client/src/app/App.tsx` **as text** and fails if any `<Route path>` there has no journey tagged with it. A journey declares its routes with `routes('/edda', '/edda/:slug')`, written literally so the check can read them. **A new page fails CI until it has a journey.**

### When the net finds a bug

A bug the net finds that is out of the current PR's scope is never skipped:

- **A deterministic one is pinned** with `test.fail(...)` and a comment naming it. The pin turns red the day the bug is fixed, so it cannot outlive the bug.
- **A racy one is worked around** with a comment naming it, because a pin on a flaky failure would flake itself.

When the fix lands, the pin or workaround comes out in the same PR. The test then exercises the fixed path and catches a regression.

All seven bugs PLAN-32a found were fixed in the follow-up `fix/plan-32a-findings` PR, and their pins and workarounds were removed (see `progress.md`). None are pinned today.

## The old-vs-new API diff

```bash
npm run build                                               # the candidate is this checkout's build
npm run test:api-diff -- --base develop                     # seeded data, reads + one write sequence
npm run test:api-diff -- --base develop --candidate develop # the tool against itself: must be zero
npm run test:api-diff -- --base develop --data path/to/app.db   # reads only, on a snapshot
```

It builds `<ref>`'s server in a temporary `git worktree` (with a clean `npm ci` of that ref's lockfile). It then seeds one scratch storage **through the base build's API**, with deliberate edge cases: unicode, 80-character names, documents with no author device, links with no title, staged and published files, folders, a custom theme and changed settings. That storage is copied twice with every file and directory timestamp kept.

Base and candidate then run **one at a time, on the same port, with the same session secret and admin cookie**, so nothing but the code differs between them.

**Reads.** The corpus is every read route with every query shape:

- all sorts × orders × filters;
- legacy and `paged=true`, with cursors walked to the end;
- every record by slug and by stale slug;
- raw endpoints, `?download`, and file content both as an attachment and `?inline=1` (a browser preview's headers);
- admin reads with and without a session.

For each request it compares the status, `content-type`, `location`, `content-disposition`, `access-control-allow-origin` and **the body bytes**. A zip is compared by its sorted entries (name, CRC-32, size), because a folder archive lists its files in the watcher's boot-scan order, which can differ between two boots of the same build.

**Writes.** One scripted sequence covers every write route's success and refusal paths (400/404/409/413/422). It is compared after rewriting only a short, explicit list of generated values: ids, slugs, stored names, device ids, timestamps, and the relic name an unnamed document is given.

**Excluded by nature**, each with its reason in `corpus.ts`:

| Endpoint              | Why                                          |
| --------------------- | -------------------------------------------- |
| `/metrics`            | runtime gauges of this process               |
| `/api/events`         | an endless SSE stream                        |
| `/api/heimdall/stats` | uptime and live counters                     |
| `/api/heimdall/about` | each build's own commit and build date       |
| `/api/presence`       | connection times                             |
| `/api/health`         | process uptime                               |
| `/api/nimbus/down`    | a random payload pool generated at each boot |

**Intended differences** go in `e2e/api-diff/expected-differences.ts`, each with its plan and reason. Any other difference fails the run (exit 1). Exit 2 means the tool itself could not run.

**`--data`** snapshots a database with `VACUUM INTO` on a read-only connection, the same mechanism `npm run backup` uses, and runs **reads only**. The source is never written. ⚠️ Per the owner's instruction, the real-data run happens **once**, at PLAN-32c's gate, and the snapshot is deleted the moment it validates. See PLAN-32.

Every worktree, scratch storage and snapshot is removed before the tool exits, pass or fail. `git worktree list` should show only the main checkout afterwards.

## What stays and what is temporary

| Item                                                                                               | Fate                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `e2e/` browser, cloud and CLI suites, and the CI step                                              | **Permanent**: the regression net for every later change                                         |
| `npm run test:api-diff` and `e2e/api-diff/`                                                        | Temporary: deleted in PLAN-34's final PR, once PLAN-33's and PLAN-34's changes have passed it    |
| Contract guard `strict` mode, `openapi.json` and its staleness and coverage tests, `createTestApp` | **Permanent**                                                                                    |
| `server/src/api-coverage.pending.ts` (the ratchet list)                                            | Temporary: emptied and deleted in PLAN-32c                                                       |
| Contract guard `fallback` mode, its Loki alert, its `.env.example` entry                           | Temporary: deleted after one release with no `contract mismatch` line; the default becomes `off` |
| Worktrees, scratch storages and snapshots of each diff run                                         | Removed by the tool at the end of every run                                                      |
| Probe and spike scripts                                                                            | Never committed                                                                                  |
