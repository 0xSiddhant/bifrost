# PLAN-33 — Black-box API testing

## Goal

Every server test today runs **inside** the process. The app is built with `createApp` and driven through `fastify.inject`, which never opens a socket, never runs the production entry (`bootstrap.ts` under `node --import otel.js`), and only ever sends the inputs a test author thought of. This plan adds a suite that treats the **built** server as a stranger would: a separate process on a real port, driven over HTTP, knowing nothing but the committed OpenAPI spec PLAN-32 produced. It has four parts:

- **Boot and transport tests** for what `inject` cannot reach.
- **Consumer-side contract checks** that validate responses against the spec from the outside.
- **Schema-driven fuzzing** that throws thousands of generated valid and invalid requests at every operation with the contract guard on.
- **A security sweep generated from the spec**: admin routes, path traversal, size-limit honesty, rate limits and error hygiene. New routes join it without anyone remembering to add them.

It lives in PLAN-32a's `e2e/` workspace as a Vitest suite (`e2e/api/*.e2e.ts`; Playwright is reserved for the UI, owner's call), reuses that plan's runner-agnostic `e2e/support/server.ts`, and runs in CI in the same step. Every change it leads to must keep PLAN-32a's browser, CLI and API-diff net green. The literal name is the name.

## Gate

PLAN-32 merged (all three parts). Single PR, no parts. **Merge condition:** `npm test`, the full `npm run test:e2e` (Playwright UI, the Vitest CLI suite, and the new Vitest API suite), and `npm run test:api-diff -- --base develop` on seeded data (the owner's real data was validated once at PLAN-32c and is not used again). The only differences the diff may report are the ones this plan lists in `expected-differences.ts`.

## Verified against the codebase, not assumed

- **Production entry:** `npm start` runs `node --import ./server/dist/otel.js server/dist/bootstrap.js` after `scripts/cli-sync.ts`. `bootstrap.ts` calls `main()` unconditionally; `app.ts` self-starts only as the direct entry. `test:resilience` spawns `server/dist/app.js` (not `bootstrap.js`), so **nothing today exercises the real production entry.**
- **CI order:** `.github/workflows/ci.yml` runs Install → Lint → Typecheck → Test → **Build** → backup smoke → image build. `npm test` runs before `server/dist` and `client/dist` exist, so a suite that needs the build has to be a separate step after Build.
- **The harness already exists by then:** PLAN-32a's `e2e/` workspace has a runner-agnostic `support/server.ts` (wrapped by Playwright for the UI and by Vitest for the CLI suite), which spawns the production entry from `dist` on a free port with `mkdtemp` storage, per worker, file or test. It also has `vitest.e2e.config.ts` (`*.e2e.ts`) and the no-errors and no-external-host guards, the local title sink, API-only seeding, and the lint rule that `e2e/**` imports no product source. Its CI step runs after Build.
- **Request-schema keywords in use** (counted across `server/src`): `type`, `enum`, `minLength`, `maxLength`, `minimum`, `maximum`, `pattern` (13 uses: file names, download ids, folder names, theme colours/CSS/fonts), `required`, `additionalProperties`, `items`, `minItems`, `maxItems`, `minProperties`, `default`. Nothing else.
- **Tools:**
  - `fast-check` is **not** installed (npm: 4.10.2); it has `fc.stringMatching(regex)` for `pattern`.
  - ajv 8.20.0 is already a server dependency and ships the 2020-12 build that OpenAPI 3.1 schemas need.
  - Schemathesis is not installed, and Python is not part of this project's toolchain.
- **Things a fuzzer must not trigger:**
  - Accio fetches the page `<title>` of any link saved **without** a title. There is no off-switch, so random URLs would mean real outbound requests.
  - `POST /api/heimdall/login` runs through `LoginThrottle`: per-IP, a 15-minute window, an added delay of up to 2 s per recent failure, then lockout. It is in-process and not configurable.
  - Upload, Brotli and client-logs are rate-limited per IP from `.env` (`UPLOAD_RATE_LIMIT_PER_MIN`, `BROTLI_RATE_LIMIT_PER_MIN`, `CLIENT_LOG_RATE_LIMIT_PER_MIN`).
  - `POST /api/heimdall/revoke` invalidates every admin session.
- **A real limit bug, found while drafting this plan:** `RUNESTONE_MAX_DOC_KB` (and edda/groot/atlas) default to **2048**, but no route raises Fastify's default **1 MiB** `bodyLimit` (`grep bodyLimit` finds only client-logs). A 1.5 MB runestone, POSTed to an app built with defaults, returned **`413 FST_ERR_CTP_BODY_TOO_LARGE`**: Fastify's error, not the usecase's `PAYLOAD_TOO_LARGE`. The documented cap is unreachable above ~1 MB. Existing tests miss it because they set `maxDocKb: 1`. The usecases measure the cap as `Buffer.byteLength(content, 'utf8')` of the decoded string.
- **Admin session:** an encrypted `bifrost_admin` cookie (`@fastify/secure-session`), checked against a session epoch in the DB that `/revoke` bumps. Since PLAN-32 the spec marks every guarded operation with `security: adminSession`.
- **Error envelope and the 404 path:** `core/http` sends `{ error, message, details? }`, and the not-found handler answers `/api/*` with JSON 404 and everything else with the SPA's `index.html` when `client/dist` exists.
- **SSE:** `GET /api/events` (hijacked, `: connected` on open, 25 s heartbeat comment). `presence` reads the hub's connection set.

## Scope

**In:**
- A Vitest API suite in the `e2e/` workspace (`e2e/api/*.e2e.ts`), run by a new `test:e2e:api` script that `test:e2e` also runs, against `server/dist` (+ `client/dist`) and by its CI step.
- Boot, transport, contract, fuzz and security suites, as decided below.
- **Fixing what the suite finds** when the fix is small and local: starting with the document `bodyLimit` bug above. Each fix is its own `fix(<module>)` commit with the red test first.
- `docs/testing.md` (created by PLAN-32) gains the black-box, fuzz-replay and security sections.

**Out:**
- Browser and CLI journeys: PLAN-32a owns them. This plan only keeps them green.
- Load, stress and soak (PLAN-34).
- A findings fix that is not small: logged with a failing test marked `.fails` and a decisions.md row, and planned separately.
- Any docs UI (the later docs plan).

## Decisions & reasoning

### The suite only knows the built server and the spec — enforced, not intended

A black-box test that imports `server/src` stops being black-box the first time someone reaches for a repository to seed data. PLAN-32a's lint rule already bans product source under `e2e/**`, so `e2e/api/` may import only `e2e/support/`, `node:*`, test libraries, and `server/openapi.json` (read as a file).

Seeding goes through the public API, which is also the point: if seeding something is impossible over HTTP, so is using it.

The process is `node --import ./server/dist/otel.js ./server/dist/bootstrap.js`, which is literally `npm start` minus the CLI sync. It runs on a free port bound by the OS, with a fresh `mkdtemp` `STORAGE_ROOT` deleted afterwards. It **never** points at `storage/`, never at the owner's running instance, and never touches the backup agent's paths.

The server fixture is PLAN-32a's `e2e/support/server.ts`, reused as-is. Suites that change process-wide state (login lockout, revocation, low rate limits, shutdown mid-upload) use its test-scoped form.

### It runs in CI inside the existing e2e step

The API suite is plain Vitest: `e2e/api/*.e2e.ts`, picked up by PLAN-32a's `vitest.e2e.config.ts`. It is run by a new workspace script `test:e2e:api`, which `test:e2e` adds alongside `test:e2e:ui` and `test:e2e:cli`, so the existing CI step runs it and no new step is needed. HTTP goes through Node's `fetch` (`e2e/api/support/http.ts`), not Playwright's request client. Pure helpers (the schema translator and the Fastify-ajv oracle) are unit-tested as `*.test.ts`, which the workspace's `test` script runs inside `npm test`.

Budget: the API suite adds at most three minutes to the CI step. Fuzz depth is the dial (`FUZZ_RUNS`, default 40 per operation in CI). A deep local run is `FUZZ_RUNS=1000 npm run test:e2e:api -- fuzz`.

### Boot and transport: the things `inject` structurally cannot see

- **Boot:** the production entry starts with OTel loaded and answers `/api/health` and `/api/capabilities`. `SIGTERM` exits 0 within the shutdown budget. A second start on the same storage comes up clean.
- **SSE over a real socket:**
  - `: connected` arrives;
  - a `POST /api/runestone` produces `runestone.saved` on an open stream;
  - two streams both receive it;
  - closing one drops it from `/api/presence`.
- **Streams:**
  - an upload of a generated 300 MB body completes, and the server's RSS (read from `/metrics`' `bifrost_process_resident_memory_bytes`) stays under a stated bound. That bound is a correctness promise: architecture.md's "flat memory at 2 GB". PLAN-34 measures throughput;
  - a `Range` download returns `206` with the right `Content-Range`, and an unsatisfiable range returns `416`;
  - a folder `/archive` streams a valid zip with no `content-length`;
  - a Brotli round trip returns the input bytes.
- **Shutdown mid-upload:** `SIGTERM` while a large upload is in flight still exits promptly (`forceCloseConnections`), and the next boot sweeps `tmp/`.
- **HTTP plumbing:**
  - `/api/nope` returns a JSON 404;
  - `/some/client/route` returns `index.html`;
  - a built asset is served with its content type;
  - every `GET` operation answers `HEAD` with no body;
  - keep-alive connections are reused across requests.

### Consumer-side contract: validate from the outside, against the committed file

PLAN-32's guard checks responses against the schemas **in the running code**. This suite checks them against **`server/openapi.json`**, the file a consumer would read. If the two ever disagree, PLAN-32's snapshot test already fails, so this is a second witness, not a duplicate. ajv's 2020 build compiles each operation's response schemas straight from the spec (OpenAPI 3.1 needs no translation).

A happy-path journey per tag seeds data and calls each operation. Every response is validated, including its status being one the spec lists for that operation. A coverage report then lists every `operationId` that never produced a 2xx across journeys and fuzz, and **an empty report is a pass condition**. That is what closes PLAN-32's admitted gap, "the guard only sees responses a test produces".

### Schema-driven fuzzing with fast-check, through a translator that refuses what it does not know

`e2e/api/fuzz/arbitraries.ts` turns an operation's request schemas (path params, query, JSON body) into fast-check arbitraries. It covers exactly the keyword set verified above, using `fc.stringMatching` for `pattern`. It **throws on any other keyword**, so a future schema using `format` or `oneOf` breaks the fuzzer loudly instead of being fuzzed as if the keyword were not there.

From each operation it builds two generators:

- **Valid requests.** Property: the status is one the spec declares, never 5xx, and the body validates (the server also runs with `API_CONTRACT_CHECK=strict`, so a byte-level contract slip is a 500 here and fails the property). Strings deliberately include the awkward cases: empty, maximum length, astral characters, lone surrogates, U+2028 (line separator), NUL, RTL marks. Those are exactly where fast-json-stringify's escaping could diverge from `JSON.stringify`, which PLAN-32's guard would then catch.
- **Invalid requests, one mutation each:**
  - drop a required field;
  - wrong type;
  - one past `minLength`/`maxLength`/`minimum`/`maximum`;
  - a value outside an `enum`;
  - an unknown property where `additionalProperties: false`;
  - a string failing `pattern`.

  ⚠️ **"Invalid" is decided by Fastify's own validator, not by the schema read literally.** Spiked on fastify 5.12.3 with its default ajv options (`coerceTypes: 'array'`, `removeAdditional: true`, `useDefaults: true`):
  - an unknown property under `additionalProperties: false` is **silently stripped** (200, not 400);
  - `123` and `true` for a `string` become `"123"` and `"true"`;
  - `null` for a `string` becomes `""`;
  - `["a"]` for a `string` becomes `"a"`;
  - `"7"` for an `integer` becomes `7`;
  - only an uncoercible value (`"x"` for an `integer`) is a 400.

  So the fuzzer runs every mutated request through an ajv instance configured **exactly like Fastify's** (same options, so the same coercion) and takes the expected outcome from that:
  - rejected → exactly `400 BAD_REQUEST` (or the operation's own documented 4xx), never 5xx;
  - accepted after coercion → treated as a valid request (a declared status, never 5xx). The mutation is still sent, because it is exactly what a sloppy client sends.

  The default options are pinned in `e2e/api/fuzz/fastify-ajv.ts` and checked by a unit test against a bare Fastify instance, so a Fastify upgrade that changes them fails loudly.

  Whether Bifrost *should* reject rather than coerce is a behaviour change for every client, and is out of scope here. It is logged as a finding, and PLAN-32's spec description states the coercion so consumers are not surprised.

Every run is seeded, and a failure prints `FUZZ_SEED=… FUZZ_PATH=…` so it replays exactly. fast-check shrinks the input before reporting.

**Hints, keyed by `operationId`,** keep the fuzzer safe without weakening it (`e2e/api/fuzz/hints.ts`):

- Accio link URLs are drawn only from `http://127.0.0.1:<sink>/…`, a local HTTP sink the suite runs, so title enrichment happens for real but never leaves the machine.
- Nimbus `mb` is capped low.
- Upload bodies are small.
- `loginAdmin` and `revokeAdminSessions` are excluded from random runs. The security suite covers them deliberately, on their own server process, because login lockout and revocation are process-wide state.
- Rate limits are raised via env for the fuzz server and tested as limits in the security suite.

A hint can narrow a field's generator but cannot remove an operation from the coverage report.

### The security sweep is generated from the spec, so new routes join it automatically

- **Admin:** every operation with `security: adminSession` returns `401 UNAUTHORIZED` with no cookie, with a tampered cookie, and with a cookie from before `/revoke`. With a live session it returns anything but 401. ⚠️ The live-session pass runs the destructive admin operations in a fixed order with **`revokeAdminSessions` last**. Revoking first would turn every later admin call into a 401 and make the sweep pass for the wrong reason. The sweep asserts the admin list is non-empty and equals the spec's count, so a spec that silently lost its markers fails here.
- **Path traversal:** every path or query parameter that names a file, folder or download id gets a fixed payload list: `../`, `..%2f`, `%2e%2e/`, double-encoded, backslash, absolute path, NUL, overlong UTF-8, unicode dot look-alikes. A canary file sits in the **parent** of `STORAGE_ROOT` with random contents. Pass means every response is 4xx and the canary's bytes appear in no response body.
- **Size-limit honesty:** for every configured cap, a body just under the cap succeeds and one just over gets that domain's documented 413 code. The caps are the four document kinds, clipboard text, client-logs body/batch, Brotli input and Nimbus test size. This is the test that is red on day one (the document `bodyLimit` bug), and it stays red until the fix below lands.
- **Rate limits:** with each limit set to 3 for a dedicated server, the 4th request in the window returns 429. Login lockout on its own process: repeated bad PINs reach `429 RATE_LIMITED` with a `Retry-After` header, and the right PIN is refused while locked.
- **Error hygiene** (asserted across *every* response the whole suite saw): no body contains the `STORAGE_ROOT` path, the repo path, a home-directory path, or a stack-frame pattern (`at … (…:line:col)`).
- **CORS:** only the four raw document endpoints send `access-control-allow-origin`, and every other operation sends none.
- **Served-type safety:** an uploaded `.html` and `.svg` come back as `text/plain` from both uploads and downloads (`core/http/mime.ts`'s promise).

### ⚠️ The document body-limit fix: size the route's `bodyLimit` from its cap, worst-case escaped

The four document kinds' `POST`/`PUT` routes get `bodyLimit` = `maxDocKb × 1024 × 6 + 16 KiB`. The cap is measured on the **decoded** string, while the body limit applies to the **encoded** JSON. A JSON string escapes a control character to 6 bytes (`\u0000`), so any smaller multiplier makes some valid document over a lower cap unreachable again. The 16 KiB covers the envelope and the `name` field. The precise cap stays where it is, in the usecase.

The trade: a client can now make the server read up to ~12 MB per request under default caps before refusal. That is bounded, per-request, and LAN-only, and it is the only way the documented 2048 KB means what it says. Lowering the defaults to fit 1 MiB instead would silently shrink a promise users already have. Because a valid document over 1 MB is refused today, this changes behaviour: a 413 that should never have happened becomes a save. It is logged as a fix, not a deviation. The spec's 413 entries for those routes keep a single code (`PAYLOAD_TOO_LARGE`), and an over-`bodyLimit` body is mapped to that code by the route's own error path. The test asserts the code, not just the status.

## API contracts

No new routes. One behaviour fix: `POST`/`PUT` on `/api/{runestone,edda,groot,atlas}` accept documents up to their configured cap (previously refused above ~1 MiB with `FST_ERR_CTP_BODY_TOO_LARGE`), and an oversize body is answered with the documented `413 PAYLOAD_TOO_LARGE` either way. `server/openapi.json` is regenerated if the 413 description changes.

## Task checklist

**Harness (extends PLAN-32a's `e2e/`)**
- [x] `e2e/package.json`: `fast-check`, `ajv` (2020 build), and `fastify` pinned to the server's version (for the oracle test); `tech-stack.md` row for `fast-check`
- [x] `e2e/package.json`: the `test:e2e:api` script, and `test:e2e` runs it
- [x] `e2e/support/server.ts`: a canary file in the parent of the scratch `STORAGE_ROOT` (opt-in); otherwise reused unchanged
- [x] `e2e/api/support/spec.ts`: load `server/openapi.json`, list operations, compile response validators (ajv 2020), coverage recorder
- [x] `e2e/api/support/http.ts`: thin `fetch` wrapper that records every response for the hygiene scan and the coverage report; cookie jar for admin sessions

**Suites**
- [x] `e2e/api/boot.e2e.ts`, `transport.e2e.ts`: per "Boot and transport"
- [x] `contract.e2e.ts`: per-tag journeys + spec validation + the coverage report (empty = pass)
- [x] `fuzz/arbitraries.ts` (throws on unknown keywords), `fuzz/fastify-ajv.ts` (the pinned default ajv options, used as the valid/invalid oracle), `fuzz/hints.ts`, `fuzz.e2e.ts` (valid + invalid properties, seed/replay)
- [x] `security.e2e.ts`: admin, traversal + canary, limits honesty, rate limits, login lockout (own process), hygiene, CORS, served-type safety

**Fixes**
- [x] `fix(runestone|edda|groot|atlas)`: route `bodyLimit` from the cap; over-limit → `413 PAYLOAD_TOO_LARGE`; an in-process integration test at the real default cap (not `maxDocKb: 1`); a browser journey saving a 1.5 MB document in each editor; the change listed in `e2e/api-diff/expected-differences.ts` with this plan and reason; `npm run api:spec` re-run
- [x] Each further finding: small → `fix(<scope>)` commit with its red test first; not small → `.fails` test + decisions.md row + PLAN-99 row

**Gate & cleanup**
- [x] Merge-condition run (see Gate): `npm test`, full `test:e2e`, `test:api-diff --base develop` on seeded data, with only the listed expected differences — _WebKit runs in CI only (it cannot launch in the implementing container)_
- [x] Cleanup: no `.fails` test left without a decisions.md + PLAN-99 row; no worktree, scratch storage, canary or snapshot left after the runs; no probe script committed; the PR lists what it deleted

**Docs**
- [x] `docs/testing.md`: black-box, fuzz replay (`FUZZ_SEED`/`FUZZ_PATH`), security sweep
- [x] `architecture.md` (testing section), `decisions.md`, `progress.md`; archive this file into `completed/` in the PR

## Acceptance criteria

1. `npm run test:e2e:api` boots the server through the production entry from `dist` on a random port with scratch storage, and leaves nothing behind afterwards.
2. No file under `e2e/api/` imports product source; adding such an import fails `npm run lint` (PLAN-32a's rule).
3. Every SSE, range, archive, Brotli, shutdown-mid-upload and HTTP-plumbing behaviour listed under "Boot and transport" is asserted over a real socket.
4. Every response the suite receives validates against `server/openapi.json`, and the coverage report lists no operation without a 2xx.
5. The fuzzer runs valid and invalid properties for every operation not excluded by a hint, never sees a 5xx, and every invalid request gets a documented 4xx. A failure prints a seed that reproduces it.
6. The fuzzer's translator throws on a schema keyword outside the verified set.
7. Every admin operation in the spec is refused without a valid, current session, and the sweep's admin count equals the spec's.
8. No traversal payload returns 2xx, and the canary's contents appear in no response.
9. A document between 1 MiB and its configured cap saves successfully, and one over the cap returns `413 PAYLOAD_TOO_LARGE` on all four kinds.
10. Rate limits and login lockout trigger at their configured thresholds, with `Retry-After` on lockout.
11. No response body in the whole run contains a filesystem path or a stack frame.
12. CI runs the API suite in the existing e2e step, adding no more than three minutes.
13. PLAN-32a's browser, CLI and cloud suites stay green, and the API diff against `develop` reports only the document body-limit difference listed in `expected-differences.ts`, on seeded data.
14. Nothing temporary remains after the PR (no worktree, scratch data, canary or probe script), and the PR lists what was deleted.

## Test checklist

**Black-box (the deliverable)**
- [x] `boot.e2e.ts`: criterion 1
- [x] `transport.e2e.ts`: criterion 3
- [x] `contract.e2e.ts`: criterion 4
- [x] `fuzz.e2e.ts`: criterion 5
- [x] `security.e2e.ts`: criteria 7–11

**Safety net (PLAN-32a, kept green)**
- [x] Full `test:e2e` and the API diff (criterion 13) — _WebKit runs in CI only (it cannot launch in the implementing container)_

**Unit**
- [x] `fuzz/arbitraries.test.ts`, in `npm test` (the e2e workspace's vitest `test` script) because it is pure: every keyword in the verified set produces values that ajv accepts against the same schema; every invalid mutation produces values ajv rejects; an unknown keyword throws (criterion 6)
- [x] `fuzz/fastify-ajv.test.ts`, in `npm test`: the pinned oracle and a bare Fastify instance agree on every spiked case (stripped extra property, `123`/`true`/`null`/`["a"]` → string, `"7"` → integer, `"x"` → 400)

**Integration (in-process)**
- [x] Each document kind at the real default cap: just under saves, just over → `PAYLOAD_TOO_LARGE` (criterion 9, also guarded by PLAN-32's contract check)

**Lint**
- [x] A deliberate `server/src` import in a scratch `e2e/api` suite fails `npm run lint`, then is removed (criterion 2)

**CI**
- [ ] The PR's CI run shows the e2e step green and the API suite's duration (criterion 12) — _pending the PR's first CI run; locally the API suite takes ~30 s_
