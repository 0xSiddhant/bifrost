# Testing Bifrost

Every kind of test this repo runs, how to run and replay each one, and which of them are permanent. `.agents/rules/coding.md` says what each change must ship; this page says how to run what is already here.

**One command runs them all:** `./bifrost test all`. It runs `npm audit` → lint → typecheck → `npm test` → build → `test:e2e`, stopping at the first failure: the same gate as CI and the `verify` skill. Use the narrower commands below to run or replay one slice.

**Why tests live in more than one place.** Unit and integration tests sit beside the code they test, in `server/`, `client/` and `cli/`. They import that code directly, run without a build, and come first in CI because they are fast. End-to-end tests live in `e2e/` and are _forbidden_ from importing product code: that rule is what proves they test what actually ships. Merging the two would lose that guarantee.

| Kind                         | Where                                                                 | Command                                 | Needs a build? | In CI              |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------- | -------------- | ------------------ |
| Unit + integration           | `server/`, `client/`, `cli/` (`*.test.ts`), plus the e2e support code | `npm test`                              | no             | yes, `checks` job  |
| API description is current   | `server/openapi.json` (checked by `openapi.test.ts` in `npm test`)    | `npm run api:spec` regenerates it       | no             | yes, in `npm test` |
| End-to-end: browser          | `e2e/browser/`, `e2e/standalone/` (Playwright)                        | `npm run test:e2e:ui -w e2e`            | yes, both      | yes, 4 shards      |
| End-to-end: installed CLI    | `e2e/cli/` (Vitest, `*.e2e.ts`)                                       | `npm run test:e2e:cli -w e2e`           | yes            | yes, own job       |
| Black-box API (PLAN-33)      | `e2e/api/` (Vitest, `*.e2e.ts`)                                       | `npm run test:e2e:api -w e2e`           | yes            | yes, own job       |
| All three of the above       |                                                                       | `npm run test:e2e`                      | yes            | yes                |
| Restart resilience           | `scripts/resilience.ts`                                               | `./bifrost test resilience`               | no             | no (on demand)     |
| Load, stress, soak (PLAN-34) | `e2e/perf/` ([`docs/performance.md`](performance.md))                 | `npm run test:load -- --profile <name>` | yes            | no (on demand)     |
| Live verification            | `.claude/skills/live-verify`                                          | the skill                               | yes            | no (manual)        |

## Unit and integration tests

`npm test` runs every workspace's Vitest suite. Server routes are tested with `fastify.inject`; the CLI's `*.int.test.ts` files spawn a real server from source through `tsx`. None of them needs `dist/`, which is why CI runs them before the build.

A server test builds its app with `createTestApp(overrides)` (`server/src/testing/app.ts`): the four required keys, a fresh temp storage root, a silent logger and the response contract guard in **strict** mode. Pass only the keys the suite cares about; pass `STORAGE_ROOT` yourself to seed files before boot or to restart over the same data.

## Response contracts and the API description (PLAN-32b)

A route's response schema is compiled into its serializer, so a wrong one changes what a client receives without failing anything. Three checks keep schemas honest:

- **The contract guard in strict mode** runs in every server test and every e2e server. A response whose serialized bytes differ from `JSON.stringify` of what the handler returned, a payload that fails the schema, or a status the route does not declare becomes `500 CONTRACT_VIOLATION` and names the route and the JSON pointer. `core/http/contract.test.ts` proves it catches each way a schema rewrites bytes: a dropped field, `null` → `""`/`0`, an emptied object, coercion, key order and an undeclared status.
- **`server/src/openapi.test.ts`** fails when the committed `server/openapi.json` is stale (`info.version` is ignored) and validates it as OpenAPI 3.1. Fix it with `npm run api:spec`.
- **`server/src/api-coverage.test.ts`** fails for any route without `tags`, a `summary`, a unique `operationId`, a success entry, a `400` entry where a request schema exists, or with `security` that does not match `requireAdmin`. Every route is described, so a new one fails here until it is (PLAN-32c deleted the temporary pending list).

## The end-to-end safety net (PLAN-32a)

`e2e/` is the fourth npm workspace. It only ever sees the **built** system, from outside:

- the hub through its two production entries, as `npm start` runs them (PLAN-36): the API, `node --import server/dist/otel.js server/dist/bootstrap.js`, on a loopback `API_PORT`, and the web host, `node web/dist/bootstrap.js`, on `PORT`. Every suite talks to the web host (`server.baseUrl`); `server.apiUrl` is the API itself, for the few tests about what sits behind it;
- the client as the web host serves `client/dist`, in real browsers;
- the CLI as a packed tarball, installed with `npm install -g --prefix <temp>`.

An eslint rule bans any import of `server/src`, `client/src` or `cli/src` from `e2e/`. A test that imported product source would test the source, not what ships.

### Running it

```bash
npm run build                                  # the e2e suites run against dist/
cd e2e && npx playwright install chromium webkit && cd ..   # once per Playwright version
npm run test:e2e                               # CLI suite, API suite, then the browser suite
```

Narrower runs, from `e2e/`:

```bash
npx playwright test browser/documents.spec.ts --project chromium-desktop
npx playwright test -g "Pensieve"              # by title
npx vitest run --config vitest.e2e.config.ts cli/transfer.e2e.ts
npx playwright show-trace test-results/<test>/trace.zip   # replay a failure step by step
```

A failing Playwright test keeps its trace, a screenshot, and the output of the server it ran against (`server-output` in the report). In CI the report and `test-results/` are uploaded as a `playwright-report-<shard>` artifact, one per failing shard.

**How CI runs all this** (`.github/workflows/ci.yml`): every job in parallel, so the wall clock is the slowest job, not the sum. `checks` runs audit, lint, typecheck, `npm test` and the backup smoke; `e2e-cli-api` builds and runs the installed-CLI and black-box API suites; `e2e-ui` builds and runs the browser journeys in four shards (Chromium desktop + standalone, Chromium mobile, WebKit 1/2 and 2/2, since WebKit takes twice Chromium's time per test); `docker` builds the images. Each shard installs only its own browser. CI also runs on every push to `develop`, so the npm and Playwright caches are saved where every PR can restore them, and a newer push to a PR cancels its older run. To reproduce one shard locally: `./bifrost test e2e ui -- --project=webkit-mobile --shard=1/2`.

Where Playwright's own browser download is unavailable but a Chromium is installed, `E2E_CHROMIUM_EXECUTABLE=/path/to/chrome` points the Chromium projects at it. WebKit has no such fallback.

### Projects

| Project            | What                                             | Why                                                                                    |
| ------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `chromium-desktop` | 1280×900                                         | the Mac on the desk                                                                    |
| `chromium-mobile`  | Pixel 7, 390×844, touch                          | phones, and the layouts below 640/768px                                                |
| `webkit-mobile`    | iPhone 14                                        | the household's iPads and iPhones are WebKit, and Safari-only bugs have shipped before |
| `standalone`       | Chromium, 1280×900, against `dist-standalone/`   | the standalone site (PLAN-35): no server at all, served with the container's rules     |

### The standalone project (PLAN-35)

`e2e/standalone/` runs against `client/dist-standalone/` (build it first: `./bifrost build --standalone`), served by `e2e/support/static-server.ts` with the location rules of the committed `docker/nginx-standalone.conf`; `static-server.test.ts` parses that file and fails if the two disagree. No Bifrost server starts.

On top of the usual guard, every context carries a **no-request guard**: the page may ask its own origin only for files of the build (and navigations). Anything else, an `/api/…` call above all, fails the test at teardown, even though the static server would have answered it with the app shell. The hub stubs never touch the network, so the cold-load journey also reads their call counter (`globalThis.__bifrostStubCalls`) and expects zero.

The old `cloud` project is gone: the client's nav comes from its build now, not from asking the server, so the security half of that check is an API test (`e2e/api/cloud-profile.e2e.ts`): a `DEPLOY_PROFILE=cloud` server still refuses every local-only route.

`routes.spec.ts` checks both builds' coverage: every `App.tsx` route has a journey, every feature root in `client/src/core/features.ts` is journeyed by the hub suite, and every `needsHub: false` root by the standalone suite too.

### Isolation

Each Playwright worker and each Vitest e2e file starts **its own hub** (the API and the web host, each on a free port), with:

- a fresh `mkdtemp` storage root;
- every key in `.env.example` and in your own `.env` blanked to its built-in default. The server's dotenv never overrides a set key, so without this a developer's real `.env` would leak into the suite;
- `NODE_ENV=production`, `OTEL_ENABLED=false`, a fixed test PIN, a unique `MDNS_NAME` per port, and `WEB_HOST=127.0.0.1`, which keeps the web host off the LAN and turns its mDNS off, so a run on the host Mac never advertises a second `bifrost.local`.

A test can stop the whole hub (`halt()`), only the API (`haltApi()`, then `restartApi()`), or only the web host (`haltWeb()`). A load run can ask for the API alone (`direct`).

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
- connection-refused noise, but only after a test calls `guard.allowConnectionLoss()` because it stopped the server on purpose;
- the web host's `502` (`503` for `/go`) and the browser's lines for them, but only after a test calls `guard.allowApiOutage()` because it stopped the API on purpose (PLAN-36). A 5xx from anything else still fails.
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

## The black-box API suite (PLAN-33)

`e2e/api/` treats the built server as a stranger would: the production entry on a real port, over HTTP, knowing nothing but the committed `server/openapi.json` (read as a file). It runs with `API_CONTRACT_CHECK=strict`, so a response a schema would rewrite is a 500 here. `npm run test:e2e:api -w e2e` runs it, then the **coverage report**: every operation in the spec must have produced a success somewhere in the run, or the step fails.

| File               | What it proves                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boot.e2e.ts`      | The production entry starts with OpenTelemetry loaded by `--import`, exits 0 on SIGTERM within 10 s, and restarts clean on the same storage                                                                                                                                                                                                               |
| `transport.e2e.ts` | What `inject` cannot see: the event stream over a socket (two streams, presence on close), a 300 MB streamed upload with flat server memory, `Range` 206/416, a folder zip verified entry by entry, a Brotli round trip, SIGTERM mid-upload with `tmp/` swept on the next boot, JSON 404 vs the SPA, asset types, `HEAD` on every `GET`, keep-alive reuse |
| `contract.e2e.ts`  | A happy-path journey per tag; every response is validated against `openapi.json`, and every one of its operations succeeds                                                                                                                                                                                                                                |
| `fuzz.e2e.ts`      | Two seeded properties per operation, generated from its request schemas (see below)                                                                                                                                                                                                                                                                       |
| `security.e2e.ts`  | Admin guarding, path traversal against a canary, size-limit honesty, rate limits and login lockout, CORS, served-type safety; behind the web host, the throttle counts each forwarded device, and a forged `X-Forwarded-For` changes nothing (PLAN-36)                                                                                                    |
| `modes.e2e.ts`     | `npm start`'s entry in each run mode (PLAN-36): `full` (the hub client on `PORT` for the LAN, the API on loopback only), `api` (nothing on `PORT`), `web` (the standalone client, forwarding nothing) and `WEB_HOST=127.0.0.1` (this machine only, mDNS off with its reason)                                                                              |

Every file ends with the same check: every response it received met the spec, and **no body leaked a filesystem path, a stack frame, or the traversal canary**.

### The fuzzer

`fuzz/arbitraries.ts` turns each operation's request schemas into fast-check generators. It covers exactly the keywords the server uses and **throws on any other**, so a schema using `format` or `oneOf` breaks the fuzzer loudly. Strings lean on the escaping edge cases: NUL, U+2028, RTL marks, astral characters, and lone surrogates in JSON bodies. For each operation:

- **valid requests** must never get a 5xx, must get a declared status, and must return a spec-valid body;
- **invalid requests** each carry one mutation: a dropped required field, a wrong type, one past a bound, a value outside an enum, an unknown property, or a string failing its pattern. When Fastify's own validator refuses one, the answer must be a declared 4xx. "Refuses" is decided by `fuzz/fastify-ajv.ts`, an oracle using Fastify's ajv defaults, which coerce `"7"` to 7 and strip unknown properties. `fastify-ajv.test.ts` checks that oracle against a bare Fastify instance.

`fuzz/hints.ts` keeps it safe:

- Accio URLs only point at a local title sink;
- Nimbus payloads are small;
- uploads, Brotli and Nimbus get raw bodies;
- `login`, `revokeSessions`, `logout` and the event stream are excluded, each with its reason (the contract and security suites cover them).

Depth and replay:

```bash
FUZZ_RUNS=1000 npm run test:e2e:api -w e2e -- fuzz          # a deep local run (CI uses 40)
FUZZ_SEED=… FUZZ_OP='…' FUZZ_PATH='…' npm run test:e2e:api -w e2e -- fuzz -t '…'   # printed on any failure
```

It found two bugs on its first runs, both fixed in PLAN-33:

- path parameters over 100 characters were refused by the router with a 414;
- a short invalid Brotli input got a 200 that was then cut off mid-body.

The contract suite found a third: the spec described raw JSON documents as a JSON string.

### The security sweep

- **Admin:** it reads the operations from the spec's `security` markers, so a new admin route joins it automatically.
  - Each one must answer `401 UNAUTHORIZED` with no cookie, with a tampered cookie, and with a cookie from before `/revoke`. The requests are generated from the operation's own schemas, so validation never answers first.
  - With a live session, each one must answer anything but 401. `revokeSessions` runs last, because it ends that session too.
- **Traversal:** every file, folder and download parameter refuses encoded, double-encoded, backslash, NUL, overlong-UTF-8, look-alike-dot and absolute payloads with a 4xx. `STORAGE_ROOT` sits in a scratch "jail" beside a canary file of random contents, which must never appear in a response.
- **Size limits:** for the documents, clipboard, client logs, Brotli and Nimbus, the cap itself must pass and one byte (or one entry) more must be refused with the domain's code.
- **Rate limits and login lockout:** each runs on a server of its own, because the state they change is process-wide.

## The API docs (PLAN-38)

Swagger UI on the API server ([`api.md`](api.md)) has three checks:

- `server/src/core/http/docs.int.test.ts`: `/docs` is served, `/docs/json` is the committed spec, the CSP allows nothing off-origin, and the validator badge is off.
- `e2e/browser/docs.spec.ts`: the UI on the API port renders every module and the real-data note, and "Try it out" runs `GET /api/v1/health`. A write offers it too. The usual guard proves no external request and no CSP violation.
- `e2e/api/docs-exposure.e2e.ts`: through the web host, `/docs` and its spec are never served, and neither client build names them.

The spec itself passes Redocly's `recommended` lint in `server/src/openapi.test.ts`, with each unmet rule listed and justified.

## What stays and what is temporary

| Item                                                                                               | Fate                                                                                               |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `e2e/` browser, standalone and CLI suites, and the CI step                                              | **Permanent**: the regression net for every later change                                           |
| `npm run test:api-diff` and `e2e/api-diff/` (the old-vs-new API diff)                              | **Deleted** in PLAN-34, the last change it guarded                                                 |
| Contract guard `strict` mode, `openapi.json` and its staleness and coverage tests, `createTestApp` | **Permanent**                                                                                      |
| `e2e/api/` (the black-box API suite, PLAN-33)                                                      | **Permanent**                                                                                      |
| `e2e/perf/` and `npm run test:load` (the load harness, PLAN-34)                                    | **Permanent**, on demand: never in `test:e2e` or CI. Its `load-results/` files are never committed |
| `server/src/api-coverage.pending.ts` (the ratchet list)                                            | **Deleted** in PLAN-32c, once every route was described                                            |
| Contract guard `fallback` mode, its Loki alert, its `.env.example` entry                           | Temporary: deleted after one release with no `contract mismatch` line; the default becomes `off`   |
| Probe and spike scripts                                                                            | Never committed                                                                                    |
