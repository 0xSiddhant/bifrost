# PLAN-38 — API docs (OpenAPI + Swagger UI on the API server)

## Goal

PLAN-32 made the API describe itself (a committed OpenAPI 3.1 spec generated from the running routes) and PLAN-37 versioned it. Nobody can *read* it comfortably yet. This plan serves the standard **Swagger UI** for that spec. It runs on the **API server only** (`API_PORT`, loopback by default since PLAN-36), at `/docs`, with the raw spec at `/docs/json`.

It is invisible to the Bifrost client in every way:
- not on the client's port;
- not in the hub or standalone builds;
- not in the nav;
- with no configuration: the docs are always on, with no `.env` keys (owner's call).

Everything it needs is bundled, so it works offline and contacts no external host. "Try it out" works for every method against the live hub, under a visible note that requests act on the household's real data. The literal name is the name.

## Gate

PLAN-37 merged. Single PR, no parts. **Linear sequence: 32 → 33 → 34 → 35 → 36 → 37 → 38.**

**Merge condition:**
- `npm test`;
- the full `npm run test:e2e`, plus this plan's docs journey;
- `server/openapi.json` changed **only** by the path-template merge described below, asserted by PLAN-37's v1 spec check (which compares operations by `operationId` and treats a path-parameter rename as non-breaking).

## Verified against the codebase, not assumed

- **Where the API lives by now (PLAN-36):** the API server listens on `API_HOST:API_PORT`, default `127.0.0.1:4647`. The web host on `PORT` (4646) proxies only `/api`, `/<kind>/api`, `/go` and `/metrics`, and serves the client for every other path. So a route at `/docs` on the API server is **not reachable through the client's port**: `bifrost.local:4646/docs` falls through to the SPA's not-found page. Nothing extra is needed to hide it.
- **The spec is already registered in production:** PLAN-32 put `@fastify/swagger` in `core/http/openapi.ts` (OpenAPI 3.1.0, the `adminSession` cookie scheme), registered in `buildHttp` before any route. Its committed `server/openapi.json` is the same document `app.swagger()` returns, except `info.version`.
- **Spiked — `@fastify/swagger-ui` 6.1.1** (fastify 5.12.3, scratch project):
  - it serves the UI at a configurable `routePrefix`, plus `/json` and `/yaml`, from **bundled assets** (`static/swagger-ui-bundle.js`, `index.css`, …). `index.html` references no external URL; the only `https://` string in its initializer is a code comment;
  - ⚠️ Swagger UI's default `validatorUrl` points at `validator.swagger.io` to draw a badge, which would be an external request on every page load, so this plan sets it to `null`, and the docs journey's network guard proves no external request leaves;
  - it ships a CSP option (`staticCSP`).
- **Spiked — the `/{slug}` vs `/{id}` sibling quirk** PLAN-32 deferred to this plan. `@fastify/swagger`'s `transform` hook can rename the path template **in the spec only**: the four document kinds' `GET /:slug` and `PUT`/`DELETE /:id` became one path key with `get` and `put` operations, while the real Fastify routes kept routing exactly as before (`PUT /api/v1/runestone/abc` still reached the `:id` handler). Path-parameter names never appear on the wire.
- **The admin session cookie** (`bifrost_admin`, `httpOnly`, `SameSite=strict`, path `/`) is set by `POST /api/v1/heimdall/login` on whatever origin made the request. "Try it out" from `/docs` is same-origin with the API, so logging in through the docs authorises admin calls there, exactly as the hub does on its own origin.
- **Routing rule:** `coding.md` requires any new top-level server path outside `/api/` to join `RESERVED_ROOTS` (`server/src/core/reserved-roots.ts`) and its test.
- **PLAN-37's coverage rule** fails any unversioned route outside its reasoned allowlist. PLAN-32's coverage test skips `hide` routes, and `@fastify/swagger-ui` registers its routes with `schema.hide` (verified as the first task, since the allowlist entry depends on it).

## Scope

**In:**
- `@fastify/swagger-ui` on the API server at `/docs` (`/docs/json`, `/docs/yaml`), always registered.
- "Try it out" for every method, with a real-data note in the docs' description.
- A spec-only merge of the four document kinds' `/{slug}`/`/{id}` paths into `/{key}`, so the spec passes a strict OpenAPI linter.
- Tags with descriptions (one per module), API title and description (including the versioning policy and the request-coercion note), and per-operation examples where a shape is not obvious.
- An offline guarantee (`validatorUrl: null`, bundled assets, CSP).
- Tests: integration, a Playwright docs journey (UI, the owner's rule), and a check that the client's port does not serve the docs.

**Out:**
- Serving docs on the client's port, in either client build, or linking them from the app.
- A docs site for the outside world (static export to Hostinger etc.): the docs show the owner's live hub and stay with it.
- Alternative UIs (Scalar, Redoc). Swagger UI is the standard the owner asked for, and the only one with an official Fastify plugin.
- AsyncAPI for SSE payloads, and client SDK generation.

## Decisions & reasoning

### Docs live on the API server, which already makes them invisible to the client

The owner's two conditions from the first discussion were: not exposed to the Bifrost client, and backend-only, with the client knowing nothing about it. Before PLAN-36 that would have needed a second listener on its own port, because client and API shared one. PLAN-36 has since given the API its own port, bound to loopback, behind a web host that forwards only the API prefixes. So `/docs` on the API server is:
- unreachable through the client's port (the web host never forwards `/docs`);
- unreachable from other LAN devices (loopback bind);
- absent from both client builds.

That is the separate-port design the owner originally asked for, with no new listener. To read the docs from a laptop, the owner uses an SSH tunnel (`ssh -L 4647:127.0.0.1:4647 <mac>`), documented in `docs/api.md`.

### Core, not a feature module

This settles the question left open in the first discussion. The docs are registered from `core/http/docs.ts`, beside `core/http/openapi.ts`, and wired in `buildHttp`, not as a module in `MANIFEST`:
- **No feature behaviour:** modules are features the profile manifest switches on and `/api/capabilities` lists. The docs are neither, being controlled only by `.env`.
- **Wrong scope:** the UI must read the root instance's complete spec, which an encapsulated module scope cannot own.
- **Already core:** the spec itself already lives in core. Splitting the UI out into a module would put two halves of one thing in two layers.

### No configuration: always on, every method try-able

The docs have **no `.env` keys** (owner's call). They are reachable only from the server machine, the owner is the only reader, and readable docs would not be a problem even if the API were ever exposed. So:
- there is no enable switch;
- there is no guard against a non-loopback `API_HOST`;
- there is no write switch.

Fewer keys also means nothing for `npm run setup`'s drift check to flag, and nothing to forget.

"Try it out" is Swagger UI's standard: every method is offered. Because each request hits the **live hub** (real documents, uploads and sessions), the API description opens with one plain line: "Try it out sends real requests to this hub; writes change real data." Logging in through `POST /api/v1/heimdall/login` from the docs sets the admin cookie on the API's origin, so admin operations can be tried there too, and the description explains how.

### The `/{slug}`/`/{id}` siblings merge into one path, in the spec only

PLAN-32 deferred this to the plan that would first show the spec to people: OpenAPI forbids two templated paths that differ only in parameter name, and a strict linter or code generator rejects the document. A `transform` in `core/http/openapi.ts` renames the four document kinds' path parameter to `{key}`:
- `GET` describes `key` as "the document's slug";
- `PUT`/`DELETE` describe it as "the document's id";
- **each operation keeps its own constraints** (a slug up to 80 characters, an id up to 16).

No route, handler or validation message changes; parameter names never reach the wire. PLAN-33's spec-driven fuzzer substitutes path parameters by the spec's name, so it follows automatically. The committed spec changes path keys for those operations. PLAN-37's check compares operations by `operationId` and normalises path-parameter names, so this is recognised as non-breaking, and the merge condition asserts exactly that. The spec is then validated against a **strict** linter as well as the meta-schema (`@redocly/openapi-core`'s `recommended` ruleset, as a dev dependency), and any rule the spec cannot meet is listed with its reason rather than silently disabled.

### The page itself: offline, locked down, readable

- **Offline:**
  - `validatorUrl: null`;
  - assets served from the plugin's bundle;
  - `staticCSP: true`, whose CSP (`default-src 'self'`) would also block any external fetch a future Swagger UI version adds.

  The docs journey runs the UI under the same "no external host" network guard as every other Playwright journey.
- **Readable:**
  - one tag per module, with a one-line description (from the module registry table in `architecture.md`);
  - the API `description` covers authentication (the `adminSession` cookie and how to get one), versioning (PLAN-37's policy and the deprecated unversioned paths), request coercion (Fastify strips unknown fields and coerces scalars; spiked in PLAN-33), and the real-data note for "Try it out";
  - `examples` for the shapes a reader cannot guess: paged envelopes and their cursors, the error envelope, and the four kinds' raw endpoints;
  - `deepLinking` on, so `/docs#/runestone/listRunestones` can be shared on the owner's machine.
- **Live, not stale:** `/docs/json` serves `app.swagger()`. That is the same document as the committed `server/openapi.json`, whose staleness test (PLAN-32) already fails CI when they diverge. An integration test asserts they are equal apart from `info.version`.

### `/docs` joins the reserved roots

Per the routing rule, `docs` is added to `RESERVED_ROOTS` and its test, so no future client page or go-link can claim it. PLAN-37's "every route is versioned" allowlist gains `/docs/*` with its reason (a UI and its spec, not an API).

## API contracts

| Path (API server, `API_PORT`) | Purpose | Notes |
|---|---|---|
| `GET /docs` | Swagger UI | Always on; reachable wherever the API server is (loopback by default) |
| `GET /docs/json`, `GET /docs/yaml` | The live OpenAPI 3.1 spec | Equal to the committed `server/openapi.json` (minus `info.version`) |
| `GET /docs/static/*` | Bundled UI assets | Hidden from the spec |
| Four document kinds' `/{slug}` + `/{id}` | Spec only: one path `/{key}` per kind | No route change; per-operation constraints kept |

No new `.env` keys.

## Task checklist

**Server**
- [ ] `server/package.json`: `@fastify/swagger-ui` (dependency); `@redocly/openapi-core` (dev); `tech-stack.md` rows
- [ ] Verify first: the plugin's routes are `schema.hide` (PLAN-32's coverage test skips them); record the result
- [ ] `core/http/docs.ts`: register at `/docs` (`validatorUrl: null`, `staticCSP: true`, `deepLinking`, every method try-able); an `info` boot line with the docs URL
- [ ] `core/http/openapi.ts`: the `/{key}` transform for the four document kinds (per-operation constraints and descriptions); tag descriptions; API description (auth, versioning, coercion, the real-data note); `examples` for envelopes, errors and raw endpoints
- [ ] `RESERVED_ROOTS` + test: `docs`; PLAN-37's versioning allowlist: `/docs/*` with reason
- [ ] `npm run api:spec`; the strict lint (`@redocly/openapi-core` `recommended`) added to `openapi.test.ts`, with any unmeetable rule listed and justified

**Tests**
- [ ] `server/src/core/http/docs.int.test.ts`: `/docs` served; `/docs/json` equals the committed spec minus `info.version`; CSP header present
- [ ] `e2e/browser/docs.spec.ts` (Playwright, against the API server's port): the UI renders every tag; no request leaves for an external host; \"Try it out\" on `GET /api/v1/health` returns 200; a write operation offers \"Try it out\" and the real-data note is visible
- [ ] e2e (Vitest): through the web host on `PORT`, `/docs`, `/docs/json` and `/docs/static/index.html` return the client's not-found page or 404, never the docs or the spec
- [ ] PLAN-33's API suites and PLAN-37's spec check pass on the merged `/{key}` paths

**Docs & cleanup**
- [ ] `docs/api.md`: where the docs are, the SSH tunnel recipe, that "Try it out" sends real requests, how to log in for admin calls; linked from `README.md` and `docs/testing.md`
- [ ] `architecture.md` (docs in core, loopback-only by construction), `decisions.md`, `progress.md`; archive this file into `completed/` in the PR
- [ ] Cleanup: the spike stays in the scratchpad; no probe scripts committed; the PR lists deletions

## Acceptance criteria

1. On the server machine, `http://127.0.0.1:4647/docs` shows Swagger UI for every v1 operation, grouped by module with descriptions, and `/docs/json` equals the committed spec apart from `info.version`.
2. Through the client's port (`bifrost.local:4646/docs`, `/docs/json`), the docs and the spec are never served, and no client build references them.
3. Opening the docs makes no request to any external host, and the page is served with a CSP.
4. "Try it out" is offered for every method, and the description's first line says requests act on the hub's real data.
5. The spec has one path per document kind for slug/id operations (`/{key}`), passes the strict lint, and every route still behaves exactly as before.
6. `docs` is a reserved root, and PLAN-37's versioning rule allows `/docs/*` with its reason and nothing else new.

## Test checklist

**Integration (server)**
- [ ] `docs.int.test.ts`: criterion 1
- [ ] `openapi.test.ts` strict lint and the `/{key}` merge: criterion 5
- [ ] `reserved-roots.test.ts`: criterion 6

**End-to-end**
- [ ] `docs.spec.ts` (Playwright): criteria 3 and 4
- [ ] Web-host exposure check (Vitest): criterion 2

**Manual**
- [ ] The owner opens the docs on the Mac, then through the documented SSH tunnel from another machine, and tries a read
