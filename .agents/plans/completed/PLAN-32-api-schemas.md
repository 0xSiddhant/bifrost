# PLAN-32 — API schemas & contract tests, behind an end-to-end safety net

## Goal

The server's 95 routes validate what comes **in** (most have request schemas) but describe nothing about what goes **out**: no route declares a response schema, a tag or a summary. Nothing tests the client or the installed CLI against the real server either. The client's 104 test files run in jsdom against mocked data or no network at all, the CLI's integration suites drive `main()` in-process rather than the installed binary, and the only real-browser check is the manual `live-verify` skill. So a server change that alters a response would reach the client unnoticed.

This plan does two things, in this order:

1. **It builds the safety net first, against today's unchanged code.** That means:
   - a Playwright end-to-end suite that walks every page of the built app in real browsers, including two devices at once;
   - an end-to-end suite for the **installed** `bifrost` CLI;
   - an old-vs-new API diff that replays every read route against two builds and compares bytes, on seeded data, plus **one single run** on a read-only copy of the owner's real database, deleted as soon as it has validated.
2. **Then it adds the response schemas.** Every route gets a response schema per status, `tags`/`summary`/`operationId` and a `security` marker, proven true by a contract guard that fails any response not byte-identical to what the route sent before. The result is generated into a committed OpenAPI 3.1 spec (`server/openapi.json`).

For the first release after the schemas land, production runs a **fallback** mode that sends the original bytes and logs a warning if a schema would ever change a response. A mistake then becomes a log line, not a broken screen.

No docs page and no new route ship; the docs UI on its own loopback port is a later plan. The literal name is the name.

## Gate

PLAN-31 merged. **Declared exception: three PRs.** The safety net must be green on unchanged code before anything it protects is touched, and ~95 routes of schemas in one diff is unreviewable:

| Part | Branch | Contents | Must pass before merge |
|---|---|---|---|
| 32a | `feat/plan-32a-e2e-safety-net` | The `e2e/` workspace: browser suite, CLI suite, API diff tool. **No change under `server/src`, `client/src` or `cli/src`** | All of it green against `develop` as-is |
| 32b | `feat/plan-32b-api-schema-core` | Contract guard (`off`/`fallback`/`strict`), shared schemas, OpenAPI registration, spec snapshot, coverage ratchet, shared test helper; core routes + the four document kinds | `npm test` (guard on) · full e2e · API diff vs `develop` on seeded data, zero differences |
| 32c | `feat/plan-32c-api-schema-rest` | Every other module, `presence`/`qr-tool` integration tests, ratchet emptied, cleanup | Same as 32b, against `develop` with 32b merged, **plus the one-time real-data run** (see the API diff decision) |

32c may be stacked on unmerged 32b at the owner's direction (the 12b/16b/17b/18b precedent). 32b may **not** start before 32a is merged: a net installed after the change cannot tell you what the change broke.

## Verified against the codebase, not assumed

- **Route inventory:** dumped from `createApp` (local profile, scratch storage). **95 method+path routes** across 22 modules and core, plus auto-`HEAD` twins and the SPA `*` fallback. Core owns `GET /api/capabilities` (`app.ts`) and `GET /api/events` (`core/sse`).
- **No response schemas exist** (`grep -rn "response:" server/src` finds none in route code). Request schemas are plain `as const` JSON Schema at the top of each route file. PLAN-31 put one shared fragment in core (`core/paging.ts` → `pagedQueryProperties`).
- **Response types are TypeScript interfaces:** summaries in `core/bus/events.ts`, records in each module's `ports.ts`, envelopes in `core/paging.ts`.
- **Error envelope:** `core/http/index.ts` sends `{ error, message, details? }` (`AppError`), `{ error: 'BAD_REQUEST', message }` (validation), and plugin 4xx as `{ error: code, message }`. `details` is free-form.
- **Admin routes** use `preHandler: app.requireAdmin`, in loki, screensaver, offline-mode, audit-log, heimdall (+about) and themes. **Spiked:** a root `onRoute` hook can identify that guard on routes in encapsulated scopes, including when it is wrapped in an array.
- **Spiked — a response schema rewrites the bytes** (fastify 5.12.3, fast-json-stringify 7.0.1):
  - an undeclared property is **dropped**, including in array items;
  - `null` under `string` becomes **`""`**, and under `integer` becomes **`0`**;
  - a bare `object` is **emptied to `{}`**;
  - `5` → `"5"` under `string`, and `"7"` → `7` under `integer`;
  - a missing `required` property is a loud 500;
  - `additionalProperties: true` keeps extras;
  - `anyOf: [array, object]` picks correctly, but two indistinguishable object branches **pick the first and empty the payload**;
  - strings, streams and undeclared statuses bypass the serializer;
  - `preSerialization` sees the raw object first.
- **Spiked — the guard:** a root `preSerialization` hook reads `request.routeOptions.schema.response[status]` and validates the JSON round-trip of the payload with ajv against a strictified schema. It caught an extra field, a `null` under `string`, and a `Date` under `string` (which is why it validates the round-trip, not the object).
- **Spiked — `@fastify/swagger` 9.9.1:**
  - it reads routes in encapsulated scopes when registered on the root first;
  - it registers **no route** of its own;
  - `tags`/`summary`/`security` pass through;
  - OpenAPI 3.1.0 keeps `['string','null']` as a type array;
  - `/:slug` (GET) and `/:id` (PUT) siblings become two path keys.

  `@fastify/static` registers its `/*` with `hide: true` by default (its source).
- **Client tests cannot see the server:** 104 client test files run in jsdom, and only ~4 touch the network layer (one stubs `fetch`, three `vi.mock` a core API module). Real-browser checking exists only as the manual `live-verify` procedure (headless Chrome + CDP from throwaway scripts). No Playwright or Puppeteer is installed (`@playwright/test` is 1.63.0 on npm).
- **Client routes** (from `client/src/app/App.tsx`): `/`, `/upload`, `/downloads` (+ `/folder/:folderId`), `/hermes`, `/wardens`, `/sigil`, `/runestone` (+ `/:slug`, `/library`, `/mimir`, `/pensieve`), `/variant`, `/edda` (+ `/:slug`, `/library`, `/pensieve`, `/preview/:slug`), `/groot` (+ …), `/atlas` (+ …), `/loki`, `/accio`, `/nimbus`, `/portkey`, `/brotli`, `/saga` (+ `/:slug`), `/pensieve`, `/ollivanders`, `/diagon-alley` (+ `/:toolId`), `/muninn`, `*`.
- **The device identity** is `localStorage['bifrost.deviceId']` plus the `x-bifrost-device` header and the SSE `?deviceId`. Separate browser contexts are therefore separate devices.
- **CLI:**
  - 12 commands (`clip config devices doctor open portkey preview pull push speed status update`);
  - config under `XDG_CONFIG_HOME` when set;
  - the browser is opened via the `open` package, and `--json` never opens one;
  - `update` calls the GitHub releases API;
  - the existing suites drive `main()` in-process against a `tsx`-spawned server, so **nothing tests the packed, installed binary**. `npm run build`'s `cli-sync` installs globally, except under `CI`.
- **The cloud profile currently runs on SQLite** (`DEPLOY_PROFILE=cloud` needs no database URL), so it can be booted for a capability-gating test.
- **Real-data snapshotting precedent:** `npm run backup` already takes a consistent copy with `VACUUM INTO` while the server runs. The owner's launchd backup agent is live and must not be disturbed.
- **CI** runs Install → Lint → Typecheck → Test → Build → backup smoke; GitHub's `ubuntu-latest` runners have 4 vCPUs.

## Scope

**In:**
- **32a:**
  - an `e2e/` npm workspace with two runners: Playwright for the UI (`browser` and `cloud` projects), and Vitest for the out-of-process CLI suite;
  - a generated route-coverage check against `App.tsx`;
  - the `npm run test:api-diff` tool;
  - CI and `verify` steps.
- **32b/32c:**
  - response schemas, `tags`, `summary`, `operationId` and `security` on all 95 routes;
  - the guard (`API_CONTRACT_CHECK=off|fallback|strict`);
  - shared schemas, OpenAPI registration, `npm run api:spec` + committed `server/openapi.json` + staleness test;
  - the coverage ratchet and the shared test helper;
  - `presence`/`qr-tool` integration tests;
  - a provisioned alert for fallback warnings.
- **Cleanup** of everything temporary (see "What stays and what is deleted").

**Out:**
- Any docs UI or docs route (later plan; backend-only, off the client's port).
- **Any change to what a route returns.** Wire-neutral by construction; the diff and the guard both enforce it.
- Fuzz and security testing (PLAN-33); load (PLAN-34).
- SSE payload documentation (AsyncAPI), route-param renames, type providers, client codegen.
- Visual regression (screenshot diffing): themes and the animated sky make pixel diffs noisy. Journeys assert behaviour and content.

## Decisions & reasoning

### ⚠️ The safety net comes first, and is proven against unchanged code

The owner's requirement is that this work must not break the client, and the only way to prove "didn't break" is to have a test that passes before and after. So 32a changes no product code at all. It is merged only when the browser suite, the CLI suite and the API diff (develop against develop, which must show zero differences, proving the tool itself is deterministic) are all green on `develop` as it stands. From then on, every PR in PLAN-32, PLAN-33 and PLAN-34 must keep them green. A failure is a client break caught before merge, not a flaky test to retry.

### End-to-end tests live in their own workspace and only see the built system

`e2e/` becomes the fourth npm workspace (`@bifrost/e2e`, private). It holds the support code PLAN-33 and PLAN-34 will extend, and two runners, split by what is being tested (owner's call: **Playwright is for the UI only**):

- **Playwright** (`*.spec.ts`, `playwright.config.ts`): everything asserted in a browser. That is the browser journeys, cloud-profile gating, and the cross-surface journeys, where the CLI only triggers an action and the assertion is what the browser shows.
- **Vitest** (`*.e2e.ts`, `vitest.e2e.config.ts`): everything out-of-process that has no browser. That is the installed-CLI suite here, and PLAN-33's API suites later. This is the same runner as the rest of the project.

Both drive the same `e2e/support/server.ts`. It is plain TypeScript with no runner dependency: it spawns the production entry, waits on health, and stops and cleans up. Each runner wraps it in its own fixture: Playwright as a worker- or test-scoped fixture, Vitest in `beforeAll`/`afterAll` per file. Its suites import nothing from `server/src`, `client/src` or `cli/src`, enforced by an eslint `no-restricted-imports` block, the same way modules are kept apart. They drive:

- the server through its production entry (`node --import server/dist/otel.js server/dist/bootstrap.js`);
- the client as `server` serves `client/dist`;
- the CLI as a packed tarball.

Scripts: `test:e2e:ui` (Playwright), `test:e2e:cli` (Vitest, `cli/` folder), and `test:e2e`, which runs both. None of them is named `test`, so `npm test` (which runs before the build in CI) never picks them up. Root `npm run test:e2e` runs them after `npm run build`.

The spawned server runs on **production defaults**, overriding only: `OTEL_ENABLED=false` (no exporter traffic), a scratch `STORAGE_ROOT`, a free `PORT`, and `API_CONTRACT_CHECK=strict`. Metrics and `LOG_LEVEL` stay at their defaults, because PLAN-33 reads `/metrics` and journey 18 reads the log file.

Each Playwright worker and each Vitest e2e file gets **its own server process on a free port with its own `mkdtemp` storage**, as a worker-scoped fixture, so tests run in parallel without sharing state. Some journeys change process-wide state: stopping the server (offline mode), revoking every session, tripping the login throttle, or a cloud-profile boot. These take a **test-scoped** server of their own, so they never poison a neighbour.

Pure unit tests of the e2e support code (`*.test.ts`, vitest) form the workspace's `test` script and run in `npm test`. Playwright specs (`*.spec.ts`) and Vitest e2e suites (`*.e2e.ts`) run only under the `test:e2e*` scripts; `vitest.e2e.config.ts` includes only `*.e2e.ts`, and the unit config only `*.test.ts`. The suite never touches `storage/`, the owner's running instance, or the backup agent's paths. The server runs with `API_CONTRACT_CHECK=strict` once 32b exists, so every request the browser makes is also contract-checked. (On `develop` before 32b the key is unknown, and `loadConfig` ignores unknown keys.)

### Every test fails on any error the user would never see

A global fixture fails the test on:
- any `pageerror`;
- any `console.error`;
- any response ≥ 500;
- any failed request.

The only exception is an explicit allowlist, each entry with its reason (an SSE stream aborted by navigation is expected). It also **aborts and fails any request to a non-loopback host**: fonts are self-hosted, so anything external is a bug or a leak. A silently-broken client is exactly what this catches when no journey asserts the specific thing that broke: an empty title that throws in a renderer, or a `null` that became `""` and failed a parse.

### Journeys cover every page, both devices, and the cross-surface flows

The **`browser`** project runs every journey in three configurations:
- Chromium desktop 1280×900;
- Chromium mobile 390×844;
- WebKit with iPhone emulation. The household's iPads and iPhones are WebKit, and this project has shipped Safari-only bugs before (`AbortSignal.any`, the plain-http clipboard fallback).

The journeys:

1. **Shell:** Midgard, the three hubs, capability-gated nav, theme switch persists, guide panel opens on each page that has one, deep links, the `*` page.
2. **Transfer:**
   - upload → staging → preview → rename (including the sanitizer's suggested name) → publish → Downloads → download;
   - folder upload → folder view → `.zip`;
   - device B sees each step live over SSE.
3. **Hermes:** A posts, B sees it live, copy, delete, TTL expiry (`page.clock`).
4. **Wardens:** both devices listed, rename and clear, prune.
5. **Runestone, Edda, Groot, Atlas** each:
   - create, edit, save, reload by slug, rename, then the old slug lands on the new one;
   - raw `API` link and "Copy curl";
   - download;
   - delete;
   - the size-cap message;
   - Edda: live preview, Mermaid, the public preview page. Atlas: the plist table edit round trip. Runestone: Mimir.
6. **Pensieve:** paging across kinds, type chip, author filter, live "library changed" chip, own delete.
7. **Variant:** JSON and text diff, both exports downloaded and parsed.
8. **Loki:** transform, regex tester, Calcifer run under the admin policy.
9. **Accio:** save (titles enriched from a local HTTP sink, never the internet), tags, search, infinite scroll and Load more.
10. **Portkey:**
    - create;
    - a duplicate slug offers a free variant;
    - `/go/:slug` redirects, and the hit count increments live;
    - QR, edit, delete.
11. **Nimbus:** a small test completes; a second concurrent run is refused.
12. **Brotli:** compress → decompress round trip, the hand-off into an editor, and the format detector.
13. **Diagon Alley:** every one of the 13 toolbox tools opens in place and computes one known sample.
14. **Saga:** present a saved Edda (navigation, notes, shortcuts overlay), and drop a PDF.
15. **Heimdall:**
    - open by shortcut and by taps;
    - wrong PIN, then right PIN;
    - settings, themes (enable, disable, upload, delete), History, stats, About/changelog;
    - screensaver, offline-mode and Loki policy;
    - revoke ends the session in the second device too.
16. **Nótt:** the idle overlay appears after the configured idle time (`page.clock`), and a click or keystroke dismisses it.
17. **Offline mode:** a warmed page still opens after the server is stopped; an un-warmed one shows the route boundary panel, not the crash card.
18. **Client logs:** an error thrown in the page lands in the scratch server's log file with `source: "client"`.

The **`cloud`** project boots a `DEPLOY_PROFILE=cloud` server and asserts the local-only pages are absent from the nav and their APIs 404.

**CI time:** the journeys run in parallel workers with one server each. Target: the whole `test:e2e` step under 15 minutes on `ubuntu-latest`. If it grows past that, the Playwright projects are sharded across two CI jobs (`--shard`) rather than trimmed; trimming is how coverage rots.

**Coverage cannot rot silently:** `routes.spec.ts` reads `client/src/app/App.tsx` **as text** (not an import) and fails if any route path there has no journey tagged with it. A new page therefore fails CI until it gets a journey.

### The installed CLI is tested as a user installs it

The CLI suite (`e2e/cli/*.e2e.ts`, Vitest; no browser, so no Playwright):
1. runs `npm pack` on `cli/`;
2. installs the tarball into a temporary `--prefix`, never the global one;
3. runs that binary with a temp `HOME` and `XDG_CONFIG_HOME`, pointed at that file's server, so the owner's real config is untouched.

It covers, for every command except `update`:
- human output **and** `--json` (parsed);
- the documented exit codes, including server-down;
- TTY vs pipe, using `script` for a real pty: colour and progress bars appear on the TTY and vanish in the pipe. `script` takes different arguments on macOS (`script -q /dev/null <cmd>`) and Linux (`script -qec <cmd> /dev/null`), so `e2e/support/pty.ts` picks per platform, and a unit test covers both argument shapes;
- that `--json` never spawns a browser.

`update` is excluded because it calls GitHub; its unit tests stay. `preview` and `open` run with `--no-open`, or `--json`.

Cross-surface journeys stay in **Playwright** (`e2e/browser/cross-surface.spec.ts`), because what they assert is the UI; the test spawns the installed binary from the CLI suite's install step as its trigger:
- `bifrost push -d` → the browser's Downloads shows the folder live;
- a browser-saved Edda → `bifrost preview <slug>`;
- `bifrost clip` → Hermes on the second device;
- `bifrost portkey add` → the go-link resolves in the browser.

### The API diff compares two real builds, byte for byte, on the same data

`npm run test:api-diff -- --base <ref> [--data <path/to/app.db>]` does five things:

1. builds `<ref>` in a temporary `git worktree` (server only);
2. seeds one scratch storage **through the API** against the base build (documents of every kind with edge-case content: unicode, empty optional fields, `null` titles, maximum-length names; links with and without titles; files and folders; themes; settings);
3. copies that storage twice, **preserving file timestamps** (`fs.cp` with `preserveTimestamps`). The downloads and uploads listings include each file's `mtime`, so a plain copy would make every listing differ for no reason;
4. starts base and candidate on the copies;
5. replays a request corpus against both.

The corpus is every read route with every query shape: all sorts × orders × filters, legacy and `paged=true`, cursors walked to the end, every record by slug and by stale slug, raw endpoints, `?download`, admin reads with a session.

It compares status, the relevant headers (`content-type`, `location`, `content-disposition`, `access-control-allow-origin`) and the **body bytes**. Then it runs one identical scripted write sequence on both and compares after normalising only a short, explicit list of generated values (ids, timestamps, random slug suffixes).

Endpoints that differ by nature are excluded, each with its reason: `/metrics`, `/api/events`, `/api/heimdall/stats` (uptime), `/api/heimdall/about` (build stamp), `/api/presence` (connection times).

Intended differences go in `e2e/api-diff/expected-differences.ts`, each with the plan and reason. PLAN-32 has none, and PLAN-33's document `bodyLimit` fix is the first expected entry. **`--data`** snapshots the given database with `VACUUM INTO` into scratch storage (read-only on the source, the same mechanism `npm run backup` uses) and runs **reads only**. Every real row then passes through every schema once, which is the case no seeded data can fully imitate: a document saved without a device header has `authorDeviceId: null`, which seeding through the API never produces.

⚠️ **The real-data run happens exactly once** (owner's instruction, 2026-10-04: "run with real database data, but keep it one time only, so once validated delete them"). It runs at 32c's gate, the first moment every one of the 95 routes has its schema, so a single run covers every schema this plan writes. Before it, 32a and 32b use seeded data only. After it, PLAN-33 (whose one change is to the document write path, which a reads-only run cannot see) and PLAN-34 use seeded data only. The snapshot is deleted **immediately after that run validates**, by the tool itself, before the PR is even raised. It is never committed, never copied anywhere else, and never kept for a re-run. If the run finds a difference, the fix is made, re-proven on seeded data plus the guard, and the real-data run is repeated once more for that fix, again deleted straight after. That is the only case in which a second run is allowed, and it is logged in `progress.md`.

After 32c, a check asserts that every `GET` operation in `server/openapi.json` appears in the corpus.

### ⚠️ A response schema is not documentation — it rewrites the bytes

Fastify compiles each response schema into a serializer that writes only what the schema declares, coerced to the declared type. A forgotten field is **dropped**, a nullable `string` turns `null` into `""`, and a bare `object` arrives **empty**. None of this fails anything: the client just gets less. The rules that follow from this:

- nullable fields are type arrays (`['string', 'null']`);
- free-form objects carry `additionalProperties: true`;
- object `anyOf` branches are told apart by `required`;
- the guard and the API diff enforce it.

### The contract guard: `strict` in tests, `fallback` in production for the first release

`core/http/contract.ts` registers root hooks according to `API_CONTRACT_CHECK`:

- **`strict`** (every server test, every e2e server, the API diff's candidate). `preSerialization` records `JSON.stringify(payload)` (the pre-schema bytes) and validates its parse against a **strictified** schema (`additionalProperties: false` added to every object that declares `properties` without saying otherwise). `onSend` then requires:
  1. the serialized body is **byte-identical** to the record;
  2. the strict validation passed;
  3. the status is one the route declares (5xx and `HEAD` exempt).

  A violation becomes `500 CONTRACT_VIOLATION`, naming the route, the status and the ajv error.
- **`fallback`** (production default from 32b until a clean release). `preSerialization` records the bytes. `onSend` compares, and on a mismatch **sends the recorded bytes instead** (Fastify computes `content-length` after `onSend`) and logs `warn` `contract mismatch` with route, status and the JSON pointer of the first differing value. It **never logs the values themselves**, because a document's content does not belong in the log archive. No ajv runs, so the cost is one extra `JSON.stringify` per JSON response. A schema mistake can therefore never reach a client, only the log. `observability/` gains a provisioned Loki alert rule on that line.
- **`off`:** no hooks; the serializer's speed benefit is fully realised.

Byte-identical rather than "semantically equal": the CLI's `--json` output and `curl | jq` pipelines see bytes, and PLAN-31 set byte-identical as the bar. It is achievable because fast-json-stringify writes properties in schema order, and schemas are written in handler order.

### Schemas stay plain JSON Schema beside the routes; TypeScript types stay the source of truth

Response schemas follow the existing `as const` idiom in the same file as the request schemas. A module whose shapes span several route files (file-transfer, heimdall) gets `routes/schemas.ts`.

Rejected: a type provider (TypeBox, zod 4's `toJSONSchema`). It would rewrite ~95 handlers in a new idiom and still not prove a handler returns what its type says. The guard and the diff check the real JSON.

### Every route gets tags, summary, operationId; admin routes declare security

- **`tags`:** the module name; core's two routes are tagged `core`.
- **`summary`:** imperative, ≤ 60 characters; nuance goes in `description`.
- **`operationId`:** added beyond the ask, for one word per route; camelCase verb + noun (`listRunestones`, `loginAdmin`). PLAN-33 keys on it.
- **`security: [{ adminSession: [] }]`:** on every `requireAdmin` route (`bifrost_admin` cookie scheme). The coverage test cross-checks it against the real `preHandler`.

### Non-JSON routes are documented, never serialized

These are SSE, `/metrics` text, raw documents and their 301s, the `/go` 302, file and range streams, `/archive` zip, Brotli and Nimbus byte streams, and multipart upload. They get media-type-keyed response entries (`format: binary` where it applies), a `description`, and `headers` (`Location`, `Content-Range`). Strings and streams bypass the serializer (spiked).

⚠️ The first route of each kind is converted alone and must pass its integration test, the e2e suite and the diff before the rest follow. If Fastify refuses a media-type entry on a hijacked or streamed route, that route documents its body in `description` and says why in a comment. Bodies that cannot be schema'd without breaking streaming (multipart, raw octet) are documented in `description`.

### Errors are documented per status with one shared envelope

`core/http/schemas.ts`:
- `errorResponseSchema`: `required: ['error', 'message']`; `details` carries `additionalProperties: true`, or it would arrive empty;
- `errorResponses(...codes)`;
- `noContent`.

The guard fails any 4xx a test observes that the route does not declare.

### Shared pieces live in core; modules own their shapes

Core holds the cross-cutting pieces:
- `core/http/schemas.ts`;
- `core/http/contract.ts`;
- `core/http/openapi.ts`;
- `core/paging.ts`, which gains `documentListPageSchema(item)` / `cursorListPageSchema(item, extra)` (PLAN-31's precedent).

Module shapes stay in modules. The four document kinds each declare their own summary schema, the same deliberate duplication as their repositories.

### The spec is generated from the running app and committed

`@fastify/swagger` is registered **inside `buildHttp`**, before auth and modules. It adds no route. It is a production dependency because the later docs plan will serve the live spec. The spec is **OpenAPI 3.1.0**, which is JSON Schema 2020-12, so nullable arrays survive and PLAN-33 validates against it directly.

`npm run api:spec` writes `server/openapi.json` using the `local` profile, a scratch storage root and **only the four required env keys** (defaults, not the developer's `.env`). `server/src/openapi.test.ts` fails when the file is stale, ignoring `info.version` so release bumps do not break it.

The spec's top-level `description` states two things:
- the `/{slug}`/`/{id}` sibling quirk: OpenAPI forbids it, renaming is a code change for a document's sake, and it is deferred to the docs plan. The spec is validated structurally against the 3.1 meta-schema via `@seriousme/openapi-schema-validator`;
- that request validation follows Fastify's defaults (unknown properties stripped, scalars coerced; spiked for PLAN-33).

### Coverage is enforced by a ratchet across 32b and 32c

A test cannot add an `onRoute` hook after `createApp`, so `core/http/openapi.ts` also registers a root collector and decorates `fastify.routeCatalog()`: method, URL template, schema, and whether the `preHandler` includes `requireAdmin` (read at registration time, so auth registering after `buildHttp` is fine).

`server/src/api-coverage.test.ts` skips auto-`HEAD` and `hide` routes and asserts every route has:
- `tags`, `summary` and a unique `operationId`;
- a 2xx/3xx response entry;
- a `400` entry when any request schema exists;
- `security` if and only if it is guarded.

`api-coverage.pending.ts` lists the routes not yet converted, and can only shrink. 32c empties and deletes it.

### The test helper is part of the plan

A shared `testConfig(overrides)` + `createTestApp(overrides)` replaces the ~35 hand-built `createApp(loadConfig({...}))` calls. It supplies the four required keys, a fresh temp `STORAGE_ROOT`, the silent logger and `API_CONTRACT_CHECK: 'strict'`. Suites keep their own overrides.

Location is settled by `eslint-plugin-boundaries`: `server/src/testing/` if an unclassified folder may import the `server-app` category, otherwise a new `server-testing` element. The migration is its own `test(core)` commit.

### What stays and what is deleted

The owner asked that the extra test code be deleted once testing is complete and everything passes. The line is drawn between **scaffolding for this change** and **the regression net that catches the next one**. Deleting the net would remove the very protection the client depends on: the next change would again reach the client untested.

| Item | Fate | When |
|---|---|---|
| `e2e/` browser and CLI suites, the CI step | **Stay** (the permanent net) | — |
| Contract guard `strict` mode, `openapi.json`, its staleness and coverage tests, the test helper, the `presence`/`qr-tool` tests | **Stay** | — |
| `api-coverage.pending.ts` (the ratchet list) | Deleted | 32c |
| Every API-diff run's git worktrees and scratch storages; the one-time owner-data snapshot | Worktrees and storages at the end of each run; the snapshot **immediately after its single validation run** at 32c. Never committed, only ever in scratch | Every run |
| `npm run test:api-diff` and `e2e/api-diff/` | Deleted | PLAN-34's final PR, once PLAN-33's and PLAN-34's changes have also passed it (they are the last changes it guards) |
| Contract guard `fallback` mode, its alert rule and its `.env.example` entry | Deleted | A follow-up PR after one release with zero `contract mismatch` warnings in the log archive; the default becomes `off` |
| Any spike or probe script used while implementing | Never committed; written only to the session scratchpad | Always |

Each PR's description lists what it deleted. A PR is not done while `git worktree list` shows more than the main checkout, or `git status` shows a stray file.

## API contracts

**No wire change.** Every route returns byte-for-byte what it returned before; the guard and the API diff both assert it.

| Artifact | Purpose | Notes |
|---|---|---|
| `server/openapi.json` | Generated OpenAPI 3.1 description of all 95 routes | Committed; `npm run api:spec`; staleness fails `npm test` |
| `API_CONTRACT_CHECK=off\|fallback\|strict` | Contract guard | `strict` in tests and e2e; production default `fallback` until one clean release, then `off` (follow-up PR) |

## Task checklist

**32a — safety net (no product code changes)**
- [x] `e2e/` workspace: `package.json` (`@playwright/test`, `vitest`), `playwright.config.ts` (UI only: projects `chromium-desktop`, `chromium-mobile`, `webkit-mobile`, `cloud`; worker-scoped server fixture), `vitest.e2e.config.ts` (`*.e2e.ts`, file-level server, sequential within a file), `vitest.config.ts` (unit `*.test.ts`), `tsconfig.json`; scripts `test:e2e:ui`, `test:e2e:cli`, `test:e2e`; root `npm run test:e2e`; `tech-stack.md` row (Playwright: UI end-to-end only)
- [x] `eslint.config`: `no-restricted-imports` for `e2e/**` banning `server/src`, `client/src`, `cli/src`
- [x] `e2e/support/server.ts`: spawn production entry from `dist`, free port, `mkdtemp` storage, env overrides, wait on `/api/health`, SIGTERM stop + cleanup, output captured for failure reports
- [x] `e2e/support/guards.ts`: the no-errors fixture (pageerror, console.error, ≥500, failed request, external host) with its reasoned allowlist
- [x] `e2e/support/devices.ts` (two contexts = two devices), `sink.ts` (local HTTP title sink), `seed.ts` (API-only seeding)
- [x] `e2e/browser/*.spec.ts`: journeys 1–18; `routes.spec.ts` (App.tsx text vs journey tags)
- [x] `e2e/cloud/*.spec.ts`: cloud-profile capability gating
- [x] `e2e/support/cli-install.ts`: pack → temp-prefix install, shared by the CLI suite and the cross-surface journeys
- [x] `e2e/cli/*.e2e.ts` (Vitest): every command (human + `--json`, exit codes, TTY vs pipe)
- [x] `e2e/browser/cross-surface.spec.ts` (Playwright): CLI-triggered, UI-asserted journeys
- [x] `e2e/api-diff/`: worktree build, seed-once-copy-twice, corpus, write sequence + normalisation, exclusions, `expected-differences.ts`, `--data` snapshot via `VACUUM INTO` (reads only), self-cleanup; root `npm run test:api-diff`
- [x] Prove the net: `test:e2e` green on `develop`; `test:api-diff -- --base develop` against a `develop` build reports zero differences on seeded data (no real-data run here)
- [x] `ci.yml`: after Build — Playwright browser install (cached) + `npm run test:e2e`; `verify` skill gains the same step
- [x] (PLAN-99's "E2E tests (Playwright)" row was already removed when this plan was scheduled; see On completion)

**32b — machinery + first slice**
- [x] `server/package.json`: `@fastify/swagger`; `@seriousme/openapi-schema-validator` (dev); `tech-stack.md` rows
- [x] `core/config`: `API_CONTRACT_CHECK` (`off` | `fallback` | `strict`, default `fallback`) → `config.http.contractCheck`; `.env.example` documents all three
- [x] `core/http/schemas.ts`, `core/http/contract.ts` (strict + fallback), `core/http/openapi.ts` (swagger + `routeCatalog()`), wired from `buildHttp`
- [x] `core/paging.ts`: the two envelope schema builders
- [x] Shared test helper + migration of every `createApp(loadConfig(...))` call site (`test(core)` commit)
- [x] `scripts/gen-openapi.ts`, root `npm run api:spec`, `server/openapi.json`; `openapi.test.ts`; `api-coverage.test.ts` + `api-coverage.pending.ts`
- [x] `observability/`: Loki alert rule on `contract mismatch`
- [x] Core routes, `health`, and `runestone`/`edda`/`groot`/`atlas` (config, legacy + paged list as `anyOf [array, object]`, create 201, get 200/301, raw text/301 with CORS header, update, delete 204, `?download`)
- [x] Gate run: `npm test`, `test:e2e`, `test:api-diff --base develop` on seeded data: zero differences

**32c — the rest + cleanup**
- [x] `file-transfer`, `previews`, `qr-tool`, `themes`, `heimdall`, `clipboard`, `presence`, `audit-log`, `loki`, `brotli`, `accio`, `nimbus`, `portkey` (+ `/go`), `screensaver`, `client-logs`, `metrics`, `offline-mode`
- [x] `presence.int.test.ts`, `qr-tool.int.test.ts`
- [x] API-diff corpus check against every `GET` in `openapi.json`
- [x] Ratchet emptied; `api-coverage.pending.ts` deleted
- [x] Gate run as in 32b
- [ ] **The one-time real-data run:** `test:api-diff --base develop --data storage/data/app.db` (reads only, `VACUUM INTO` snapshot), zero differences. The snapshot is deleted the moment the run validates; record the run (date, row counts, result) in `progress.md` — _not run: the owner's `storage/data/app.db` is not in the cloud container that implemented 32c. The owner runs it once, locally (`npm run test:api-diff -- --base develop --data storage/data/app.db`); the tool deletes the snapshot itself_
- [x] Cleanup check: `git worktree list` shows only the main checkout; no scratch storage or snapshot left; PR description lists deletions

**Docs**
- [x] `docs/testing.md`: every kind of test, how to run and replay each, what stays and what was temporary
- [x] `architecture.md` (the net, the guard modes, the spec), `coding.md` (new routes ship schemas/tags/summary/operationId + a journey; `npm run api:spec`), `tech-stack.md`, `decisions.md`, `progress.md`
- [x] Archive this file into `completed/` in 32c's PR

## Acceptance criteria

1. 32a changes no file under `server/src`, `client/src` or `cli/src`, and its browser, CLI and cloud suites pass against `develop` unchanged.
2. Every client route in `App.tsx` has at least one journey; a new route without one fails `routes.spec.ts`.
3. Every journey passes in Chromium desktop, Chromium mobile and WebKit mobile with no page error, console error, 5xx, failed request or external request.
4. Every CLI command except `update` passes from a packed, temp-prefix install in human and `--json` modes, with the documented exit codes and TTY/pipe behaviour, and the owner's real CLI config is untouched.
5. `test:api-diff --base develop` reports zero differences for a `develop` build (the tool is deterministic), and zero for each of 32b and 32c on seeded data. The one-time run on a snapshot of the owner's database at 32c reports zero differences, and the snapshot no longer exists afterwards.
6. All 95 routes have `tags`, `summary`, a unique `operationId` and a response entry per status; the coverage test passes with no pending list; `security` matches `requireAdmin` exactly.
7. With `API_CONTRACT_CHECK=strict` the server suite and the e2e suite pass. The guard's own tests catch every failure the spike found: dropped field, `null` → `""`/`0`, emptied object, coercion, undeclared status, key order.
8. With `fallback`, a deliberately wrong schema in a scratch test still sends the original bytes and logs `contract mismatch`.
9. `server/openapi.json` is current and valid OpenAPI 3.1; staleness fails `npm test` and a version bump alone does not.
10. No docs route is served, and CI runs the e2e suite after Build.
11. After 32c: the ratchet file is gone, no worktree or scratch data remains, and the PR lists what was deleted.

## Test checklist

**End-to-end (32a, the deliverable that protects everything after it)**
- [x] Playwright: browser journeys 1–18 × three projects; `routes.spec.ts`; cross-surface journeys (criteria 1–3) — _WebKit cannot launch in the implementing container; CI is its run_
- [x] Cloud gating
- [x] Vitest: CLI suite (criterion 4)
- [ ] API diff: develop vs develop, then each part, seeded and owner data (criterion 5) — _seeded runs done for develop, 32b and 32c; the owner-data run is the one above_

**Unit**
- [x] `core/http/contract.test.ts`: strict failure modes and bypasses; fallback substitution + log line (criteria 7 and 8)
- [x] `core/config`: `API_CONTRACT_CHECK` values and default
- [x] `core/paging`: envelope schema builders accepted by the guard for real envelopes

**Integration**
- [x] Every migrated `*.int.test.ts` under the guard; `presence`/`qr-tool`; `api-coverage.test.ts`; `openapi.test.ts`; no docs path answers (criteria 6, 9 and 10)

**Manual**
- [ ] The single `--data` run at 32c (owner approved 2026-10-04; snapshot deleted right after); owner tests the built app on a real iPad and iPhone after 32c (WebKit emulation is not the device) — _owner-manual, after 32c_

## On completion

PLAN-99's "E2E tests (Playwright)" row ("automate the top 5 journeys") was removed when this plan was scheduled, 2026-10-04. PLAN-32a covers it and more: every page, not five journeys. Archiving this file to `completed/` happens in 32c's implementation PR.
