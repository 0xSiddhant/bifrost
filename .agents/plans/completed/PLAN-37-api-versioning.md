# PLAN-37 — API versioning

## Goal

No route is versioned today. Everything lives at `/api/<module>/…` and `/<kind>/api/:slug`, and compatibility has been kept by convention: changes are additive, and new behaviour is opt-in (PLAN-31's `paged=true`). This plan gives every API a version.

- **Canonical paths** become `/api/v1/…` and `/<kind>/api/v1/:slug`.
- **Old paths** are rewritten to their v1 route before routing, so they keep answering byte-for-byte as before, now with `Deprecation` headers. That covers an installed older CLI, scripts, and saved raw-document URLs.
- **The client, the CLI and every generated link** move to v1.
- **Future APIs** must be versioned. A coverage test fails any new unversioned route.
- **A written policy** says what v1 promises and when a v2 appears.

The literal name is the name.

## Gate

PLAN-36 merged. **Linear sequence: 32 → 33 → 34 → 35 → 36 → 37.** **Declared exception: two PRs** (37b may stack on unmerged 37a at the owner's direction):

| Part | Branch | Contents | Safe on its own? |
|---|---|---|---|
| 37a | `feat/plan-37a-api-v1-server` | Server routes move to `/api/v1`; old paths are rewritten to them; spec, coverage rule, equivalence test, legacy-usage metric | Yes: every existing client keeps calling the old paths and gets identical responses |
| 37b | `feat/plan-37b-api-v1-clients` | Client, CLI (with fallback for older servers), links, curl, docs and harnesses move to v1 | Yes: needs 37a's routes |

**Merge condition for each part:**
- `npm test` (contract guard on);
- the full `npm run test:e2e` (browser, CLI, API suites);
- 37a only: the legacy-equivalence test below, proving every old path returns exactly what its v1 route returns.

## Verified against the codebase, not assumed

- **No versioning anywhere:** a search of `server/src`, `client/src` and `cli/src` for `/api/v<n>`, `apiVersion` or version headers finds nothing. The only "v1" is OpenTelemetry's exporter path.
- **The route set at this point** is PLAN-35's 85 routes. They are:
  - everything under `/api/…`, including the SSE stream `/api/events` and `/api/capabilities`;
  - the four public raw-document routes `/{runestone,edda,groot,atlas}/api/:slug`, which send `access-control-allow-origin: *` because third-party tools read them;
  - `/go/:slug` (a 302 for people's go-links);
  - `/metrics` (Prometheus).
- **Route paths are string literals** in each module's route file (e.g. `'/api/runestone'`). PLAN-32 put a root `onRoute` collector and `fastify.routeCatalog()` in `core/http/openapi.ts`, and its coverage test walks that catalog.
- **Call sites:** about 128 `'/api/…'` literals across `client/src` and `cli/src`. The Pensieve's "API" and "Copy curl" links come from `apiRoute` in `client/src/core/library/registry.tsx` (`/runestone/api/${slug}` etc.). The CLI builds its URLs from one base URL in `cli/src/core/client.ts`, and an installed CLI can be older than the server.
- **Proxies:** Vite's dev proxy and PLAN-36's web host forward by prefix (`/api`, `/<kind>/api`, `/go`, `/metrics`), so `/api/v1/…` passes through with no change.
- **Spiked — automatic aliases via `onRoute`** (fastify 5.12.3, `@fastify/rate-limit` 11): registering a second route at the old path from a root `onRoute` hook carries over the schemas, the admin `preHandler` and the response serializer. ⚠️ **But each path gets its own rate-limit bucket**, so alternating old and new paths doubled the allowance (2 + 2 instead of 2).
- **Spiked — `rewriteUrl` instead:** Fastify's constructor option `rewriteUrl` maps `/api/<x>` → `/api/v1/<x>` and `/<kind>/api/<slug>` → `/<kind>/api/v1/<slug>` **before routing**. The result:
  - one route, so **one** rate-limit bucket (2 calls, then 429 across both paths);
  - query strings preserved;
  - SSE and raw-document routes rewritten correctly;
  - `request.originalUrl` still holds the old path, so an `onRequest` hook can add `Deprecation: true` and `Link: <…>; rel="successor-version"`;
  - metric route labels are the canonical template;
  - `/api/v2/…` (unregistered) still 404s.
- **Observability:** the Grafana dashboard groups by the `route` label and filters on no specific path. Series names change from `/api/…` to `/api/v1/…` (a break in history at the deploy, nothing broken).

## Scope

**In:**
- Every route under `/api/` moves to `/api/v1/`, and every raw-document route to `/<kind>/api/v1/:slug`.
- Old paths rewritten to v1 in `core/http`, with deprecation headers and a legacy-usage metric and log.
- `server/openapi.json` documents the v1 paths. The legacy rule is stated in its description, not as duplicate paths.
- PLAN-32's coverage test gains the "every route is versioned" rule, with a short, reasoned allowlist.
- Client, CLI and every generated link move to v1. The CLI falls back to old paths on a pre-versioning server.
- The versioning policy written down: `coding.md` and `architecture.md`.

**Out:**
- **`/go/:slug` and `/metrics` stay unversioned.** They are not APIs. A go-link is a human-facing URL printed on QR codes and typed from memory, and versioning it would break every saved link for nothing. `/metrics` follows Prometheus's own convention, and scrapers expect exactly that path.
- Removing the old unversioned paths: kept until the owner decides (see the policy), with a PLAN-99 row and the usage metric to decide by.
- A v2 of anything: no breaking change is planned.
- Header- or media-type-based versioning (rejected below).

## Decisions & reasoning

### Version in the path: `/api/v1/…`

The version goes in the URL, not in a header (`Accept-Version`) or a media type (`application/vnd.bifrost.v1+json`):
- a path version is visible in a browser, in `curl`, in the Pensieve's "API" link and in the spec;
- the proxies already route by prefix;
- a header version is invisible in every one of those places, and a saved raw-document URL could never pin one.

The four public raw-document routes become `/<kind>/api/v1/:slug`. The version sits right after `api`, the same position as everywhere else, so the rule reads the same for every API: "after `api/`, a version".

### Old paths keep working, rewritten before routing, not duplicated

Every old path is answered by **the same route** as its v1 twin, through `rewriteUrl` in `core/http`'s Fastify constructor:
- `/api/<x>` → `/api/v1/<x>`;
- `/<kind>/api/<slug>` → `/<kind>/api/v1/<slug>`.

Paths that already carry a version (`/api/v\d+/…`) are never rewritten. Old paths always mean **v1**, permanently, because v1 is what they meant before versions existed.

Rejected: registering an alias route per v1 route (spiked). It does copy schemas and guards. But every alias gets its own rate-limit bucket, so the old path doubles the upload, Brotli, client-log and future limits. A rewrite leaves exactly one route per operation, so a limit, a guard, a contract check, a metric label and an admin marker can never disagree between the two paths.

An `onRequest` hook sees `request.originalUrl !== request.url` and:
- adds `Deprecation: true` and `Link: <canonical path>; rel="successor-version"`;
- counts `bifrost_legacy_api_requests_total{route}`;
- logs at `debug` (the trace-level archive keeps it).

Responses are otherwise byte-identical. A redirect (308) was rejected because the CLI's streamed uploads, `curl` without `-L`, and many third-party tools reading raw documents do not follow redirects on every method.

### v1 is a promise; v2 is per module, when a break is unavoidable

The policy, written into `coding.md` and `architecture.md`:

- **v1 is frozen to additive changes:** new routes, new optional fields, new opt-in parameters. Never a removed or renamed field, a changed type, a changed status or a changed default.
- **A breaking change gets a new version for the affected module only.** For example `/api/v2/accio/…` beside `/api/v1/accio/…`, with v1 kept working until the owner decides to remove it. There is no global "everything is v2" jump. The client and the CLI call whichever version each module offers.
- **Every new route is versioned from its first commit.** PLAN-32's coverage test fails any route outside `/api/v<n>/` or `/<kind>/api/v<n>/`, except an allowlist with a reason per entry: `/go/:slug`, `/metrics`, and the static/SPA routes.
- **`server/openapi.json` is the judge.** A diff that removes or changes anything under an existing version in a PR is a breaking change and needs a new version instead. PLAN-32's snapshot test already makes such a diff visible, and this plan adds a check to that test that fails when an operation present under `v1` in `develop`'s spec disappears or loses a field.

### Old paths stay until the owner decides

The old paths are cheap to keep: one rewrite rule, no duplicate routes. Removing them breaks any installed older CLI, any script, and any raw-document URL saved in another tool. So they stay, deprecated, with the usage metric showing whether anything still calls them. Removal is a PLAN-99 row, to be planned once the metric reads zero for a release cycle. The owner decides; nothing expires on its own.

### The CLI speaks v1 and still works against an older server

37b moves `cli/src/core/client.ts` to `/api/v1`. At the first request of a run, it probes `GET /api/v1/health`:

- **200:** use v1;
- **404:** the server predates this plan, so use the old paths for the rest of the run, and print one hint on stderr ("server predates API versioning — consider updating it"). The hint is never printed in `--json` mode;
- **anything else:** handled exactly as today.

A new CLI therefore works with an old server, and an old CLI works with a new server through the rewrite.

### Client and links: one constant, enforced

`client/src/core/api.ts` gains `API_V1 = '/api/v1'`, and every call site builds from it. The Pensieve's `apiRoute` and "Copy curl" produce `/<kind>/api/v1/<slug>`. The SSE connection opens `/api/v1/events`.

A client test fails on any `'/api/` string literal in `client/src` or `cli/src` that is not versioned. It has exactly one allowlisted file: the CLI's legacy fallback in `cli/src/core/client.ts`, which must name the old prefix to fall back to it. Each allowlist entry carries its reason. It reads the files as text, the same way PLAN-32's `routes.spec.ts` reads `App.tsx`, so an unversioned call cannot creep back in.

## API contracts

| Path | Change | Notes |
|---|---|---|
| Every `/api/<module>/…` route (incl. `/api/events`, `/api/capabilities`) | **Moves to** `/api/v1/<module>/…` | Same methods, schemas, statuses and bodies |
| `/{runestone,edda,groot,atlas}/api/:slug` | **Moves to** `/<kind>/api/v1/:slug` | CORS `*` unchanged |
| Every old path above | **Still answers**, rewritten to v1 | Byte-identical body; adds `Deprecation: true` and `Link: <v1 path>; rel="successor-version"` |
| `/go/:slug`, `/metrics` | **Unchanged, unversioned** | Not APIs (see Out) |
| `/api/v<n>/…` for an unregistered `n` | 404 | Unchanged |

## Task checklist

**37a — server**
- [x] Spike already run (see "Verified"); re-run it against the real app once `rewriteUrl` is wired, as a permanent test
- [x] Every module's route literals → `/api/v1/…` and `/<kind>/api/v1/:slug`; core's `/api/capabilities` and `/api/events` likewise; **every redirect target built in a handler** (the stale-slug `301`s in the four document modules, for both `/api/<kind>/:slug` and the raw routes) points at the v1 path, so a renamed document redirects to its canonical v1 URL whichever path the client used
- [x] `core/http`: `rewriteUrl` (unversioned `/api/` and `/<kind>/api/` → v1; versioned paths untouched); `onRequest` deprecation headers; `bifrost_legacy_api_requests_total{route}` (metrics module subscribes via the bus, as for the request histogram); debug log line
- [x] `RESERVED_ROOTS` unchanged (first segments are the same), with a test asserting it
- [x] `npm run api:spec`; spec description states the old-path rule and the versioning policy
- [x] PLAN-32's coverage test: "every route is versioned" with the reasoned allowlist; PLAN-32's snapshot test: fail when a `v1` operation in `develop`'s spec is removed or loses a response field. Operations are matched by `operationId`, and path templates are compared with parameter names normalised (`/{slug}` ≡ `/{key}`), because a parameter's name never reaches the wire. An empty diff passes, so it never breaks `develop` after a merge; delete PLAN-35's one-off `openapi-removals.test.ts`, which this general rule replaces
- [x] `server/src/legacy-paths.int.test.ts`: for every operation in the spec, the old path and the v1 path return the same status and **byte-identical body**; the old path alone carries `Deprecation`/`Link`; one shared rate-limit bucket (alternating paths hit 429 at the configured count); admin routes refuse the old path without a session; SSE on `/api/events` receives events
- [x] Rewrite the testing logic this touches: server integration tests' URLs (to v1), PLAN-33's API suites (spec-driven, so they follow the spec; any hard-coded path updated), PLAN-34's load scenarios

**37b — clients**
- [x] `client/src/core/api.ts` `API_V1`; every client call site; `core/sse.ts` → `/api/v1/events`; `core/library/registry.tsx` `apiRoute` + "Copy curl" → `/<kind>/api/v1/:slug`
- [x] `cli/src/core/client.ts`: v1 with the `/api/v1/health` probe and legacy fallback + stderr hint (not in `--json`); every CLI path; `bifrost portkey` output unchanged (`/go` is unversioned)
- [x] `client/src/core/no-unversioned-api.test.ts` (text scan of `client/src` and `cli/src`)
- [x] e2e: hub journeys unchanged in intent (they now exercise v1); CLI suite passes against the new server; a CLI run with the probe forced to 404 uses old paths and still passes the core commands
- [x] One-time compatibility check (scripted in the PR, not kept): pack the CLI from the commit before 37a in a temporary `git worktree`, and run its `status`, `push`, `pull`, `clip` and `portkey ls` against the new server. Then delete the worktree
- [x] Docs: `README.md` and `cli/README.md` show v1 URLs; `docs/standalone.md` unaffected (no API); `architecture.md` + `coding.md` policy; `decisions.md`, `progress.md`; PLAN-99 row "remove the unversioned legacy paths once `bifrost_legacy_api_requests_total` reads zero for a release"; archive this file into `completed/` in 37b's PR
- [x] Cleanup: the compatibility worktree and any scratch storage removed; no probe scripts committed; the PR lists deletions

## Acceptance criteria

1. Every API route answers at `/api/v1/…` or `/<kind>/api/v1/:slug`; `/go/:slug` and `/metrics` are unchanged.
2. Every old path returns the same status and a byte-identical body as its v1 route, plus `Deprecation: true` and a `successor-version` link, asserted for every operation in the spec.
3. Old and new paths share one rate-limit bucket, one admin guard and one contract check.
4. A route registered outside a versioned prefix (and outside the allowlist) fails the coverage test; removing a field from a v1 response fails the spec test.
5. The client and the CLI call only versioned paths, enforced by the text scan; the Pensieve's "API" link and "Copy curl" produce v1 URLs.
6. A new CLI works against a pre-37 server (probe → fallback, one hint, none in `--json`); a pre-37 CLI works against the new server (verified once with a packed older build).
7. `bifrost_legacy_api_requests_total` counts old-path calls per route, and the full e2e net passes on both parts.

## Test checklist

**Integration (server)**
- [x] `legacy-paths.int.test.ts`: criteria 2 and 3
- [x] Coverage + spec tests: criterion 4
- [x] `rewriteUrl` edge cases: query strings, `/api/v1` exactly, `/api/v2/…` unregistered → 404, slugs beginning with `v1-` on raw routes, a slug that is exactly `v1` on a raw route (`/runestone/api/v1` → the slug `v1`, not the version), a stale slug through the old path redirects to the v1 canonical path

**Unit (client/CLI)**
- [x] `no-unversioned-api.test.ts`: criterion 5
- [x] CLI `client.ts`: probe 200 → v1; 404 → legacy + hint; hint suppressed in `--json`; other failures unchanged (criterion 6)

**End-to-end**
- [ ] Full `test:e2e` on 37a and on 37b (criterion 7)
- [x] CLI with forced fallback (criterion 6)

**Manual (one-time)**
- [x] The packed pre-37 CLI against the new server; then the worktree deleted (criterion 6)
- [x] A raw-document URL saved before 37a still opens in a browser and in `curl`
