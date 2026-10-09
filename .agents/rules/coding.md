# Coding Rules

## Boundaries (build-failing, via eslint-plugin-boundaries)

- `core/` never imports from `modules/`. Modules never import from other modules — communicate via the core event bus only.
- Usecases import repository/service **interfaces**, never Drizzle, `fs`, chokidar, or fetch directly.
- Client `features/` mirror the same rule: no cross-feature imports; shared code goes in `client/src/core`.

## Two client builds (PLAN-35)

- **A new client feature declares itself in `client/src/core/features.ts`**, with its route roots and `needsHub`. Gate UI on `hasFeature(id)`, never on the server's capabilities. `needsHub: false` means it works with no Bifrost server at all, and the standalone build ships it.
- **Every client call to the server is hub-only.** Write it as `export const x: typeof hubX = __HUB__ ? hubX : hubOnly('x')` (or go through `apiGet`/`apiSend`, which already are), and a hub-only lazy page as an inline `__HUB__ ? page(() => import(…)) : BridgeClosedPage`. `./bifrost build --standalone` fails if a server path survives in the bundle.
- A server action that fails offers the sheet (`showBridgeClosed`), with `download` when there is a local copy to offer. A hand-off to a hub-only page uses `hubNavigate`.
- Settings a standalone visitor can change go through `core/settings/` (`SettingsStore`), with a rule per field in `rules.ts` and cases in `rules.cases.json` that the server's overlay test runs too.

## Routing (reserved roots)

- There is one list of the app's own top-level URL path roots: `server/src/core/reserved-roots.ts` (server prefixes + every client route root + `api`/`go`). **Whenever you add a new top-level route** — a server route outside `/api/`, or a first-segment client route in `App.tsx` (`/foo`, a new hub, a feature page) — **add its root to `RESERVED_ROOTS` in the same change**, and to the assertion list in `reserved-roots.test.ts`. Portkey go-link slugs are validated against this list, so a missing entry lets a user create `/go/<name>` that shadows a real page; the guard test only checks the roots it already knows, it cannot discover new ones for you.
- Nested/param routes under an already-reserved root (`/edda/preview/:slug`, `/runestone/:slug`) need no entry — only new **first segments** do.

## TypeScript

- `strict: true`, no `any` (use `unknown` + narrowing), no non-null `!` except in tests.
- All env access through the typed config object (zod-validated at boot). Direct `process.env` reads outside `core/config` are forbidden.
- Event names and payloads are typed in `core/bus/events.ts` — one source of truth.

## Errors & logging

- Fastify error handler maps domain errors → HTTP codes; never leak filesystem paths or stack traces to clients.
- Use the module's pino logger (`deps.log`, already bound to `{ source: 'server', module }`). Client code logs through `core/log.ts` (`log.warn` / `log.error` / `log.reportError`) — never bare `console.*`, in either workspace, outside `scripts/`.
- Log at boundaries: request start/end (Fastify built-in), usecase failures, watcher events, shutdown steps.
- **Every plan ships the critical logs for the code it adds** — a plan is not done until its failure paths are logged. Each new failure path gets a `warn`/`error`/`fatal` line **where it is handled**, carrying enough context to act on (`{ err, ...identifiers }`).
- **A deliberately silent `catch` carries a comment saying why silence is correct** — so the next audit doesn't re-litigate it and trace-level noise doesn't bury the real signal. Silence is correct when the "failure" is a designed fallback (`core/copy`'s clipboard path, `core/theme`'s cached tokens, `core/deviceId`'s private-mode id, `core/build-info`'s missing dev stamp) or ordinary validation control flow. It is *not* correct when the swallow hides a real failure whose only symptom is a number quietly reading low.
- `LOG_LEVEL` defaults to `trace` and the file is a pure archive: write everything, filter in Grafana. There is no in-app viewer and no runtime level switch — `.env` plus a restart is the control.

## Security defaults

- Sanitize every user-supplied filename: strip path separators, `..`, control chars. Store under the **sanitized name itself** — no timestamp prefix (PLAN-17b) — with `-1`, `-2`, … appended only on a real collision.
- Uploaded files: mode 0644, never executed. They **are** served since PLAN-17b (`uploads/` is a staging area the sender can preview, rename, delete and publish), so `UPLOAD_EXT_BLOCKLIST` is load-bearing, not belt-and-suspenders. This reverses the PLAN-02 "no read route" rule — see decisions.md (2026-07-30).
- Serving from `uploads/` **or** `downloads/`: resolve the name through `realpath` and verify it stays inside the intended folder (prefix check) before streaming.
- Never serve a type the browser will execute same-origin: `core/http/mime.ts` maps `.html` **and `.svg`** to `text/plain` for both folders.
- Validate all request bodies/params with Fastify JSON schemas.

## Dependencies: `npm audit` is top priority

- **`npm audit` must report 0 vulnerabilities, at every severity.** CI fails a PR otherwise (`ci.yml`, "Audit dependencies"). `audit.yml` re-audits `develop` and `main` every day, because advisories are published without any change here.
- **A finding is fixed first.** When `npm install`, CI, the daily audit or anything else shows a vulnerability, stop the current task and fix it before resuming, in its own branch and PR unless it is one line in the PR already open. It is never left for a later plan or a backlog row.
- **Fix in this order, smallest first:**
  1. an update inside the existing ranges (`npm audit fix`, lockfile only);
  2. a direct dependency bump;
  3. a root `overrides` entry pinning the patched version of a transitive package, when upstream still pins the vulnerable one. Its reason goes in `decisions.md`.
- **`npm audit fix --force` is never run blind.** It downgrades or major-bumps whatever it likes; read what it would change, and prefer an override.
- **Prove the fix:** the audit at 0, plus the check of whatever uses the package. For a lint plugin, plant a violation and see it still fire. For a runtime package, run the tests that exercise it.
- **A security release is taken even if it is days old.** The "pin a release at least two weeks old" caution applies to new features, never to the fix for a known vulnerability.
- **No accepted residue without the owner.** If a vulnerability truly cannot be fixed (no patched version, no workable override), stop and ask the owner. Log their decision, the reason and a re-check date in `decisions.md`. Until they decide, the CI gate stays red.

## HTTP API (PLAN-32)

- **Every route ships described**: `tags` (its module), a `summary`, a unique `operationId`, a response entry for **every status it can answer** (the shared `errorResponses(...)` envelope for 4xx; a `400` wherever a request schema exists; `415`/`413` on body routes), and `security: [{ adminSession: [] }]` exactly when `requireAdmin` guards it. `api-coverage.test.ts` enforces all of it.
- **A response schema rewrites bytes**, it is not documentation: Fastify's serializer drops undeclared fields, turns `null` under `string` into `""`, and empties a bare `object`. So nullable fields are type arrays (`['string', 'null']`), free-form objects say `additionalProperties: true`, and properties are listed **in the order the handler builds them**. Server tests run the contract guard in `strict` mode and fail on any byte the schema changed.
- Strings and streams (raw documents, archives, SSE) are not serialized: describe them with `rawBody(mediaType, …)`. Redirects use `redirect(…)`, empty answers `noContent`.
- After changing a route, run **`npm run api:spec`** and commit `server/openapi.json`; `npm test` fails while it is stale.
- A new module's tag gets a one-line description in `TAGS` (`server/src/core/http/openapi-content.ts`), which Swagger UI shows at `/docs` (PLAN-38). The spec must pass Redocly's `recommended` lint (`openapi.test.ts`). An operation that cannot meet a rule joins that rule's reasoned list there, never a blanket disable.
- A new route joins the black-box suite on its own: the fuzzer and the security sweep read it from the spec. It needs one success in `e2e/api/contract.e2e.ts` (a `GET` is covered automatically if `seed.ts` can fill its parameters), because the coverage report fails on any operation that never succeeded (PLAN-33).
- A server test builds its app with `createTestApp(overrides)` from `server/src/testing/app.ts`, never `createApp(loadConfig(...))` by hand.

## API versions (PLAN-37)

- **Every route is versioned from its first commit**: `/api/v1/<module>/…`, or a raw document at `/<kind>/api/v1/:slug`. `api-coverage.test.ts` fails anything else; its allowlist (`/go/:slug`, `/metrics`) names a reason per entry, and a new entry needs one too.
- **v1 only grows.** Add operations, add response fields, add optional request fields. Never remove or rename an operation, a status or a response field, never make a returned field optional, never tighten a request. `openapi-compat.test.ts` fails a PR that does, against `develop`'s spec.
- **A breaking change is a new version for that module alone**: `/api/v2/<module>/…` beside the v1 routes, which keep answering. There is no global v2.
- **Callers build paths from the constant**: `API_V1` in `client/src/core/api.ts` and in `cli/src/core/client.ts`. `client/src/core/no-unversioned-api.test.ts` fails any unversioned `/api/` literal in either tree; its only allowlisted file is the CLI's fallback for pre-PLAN-37 hubs.
- **The old unversioned paths still answer, as v1** (rewritten before routing, `Deprecation` + `successor-version` headers, counted in `bifrost_legacy_api_requests_total`). Never register a route on one, and never remove the rewrite without the owner: removal is a PLAN-99 row, gated on that metric reading zero for a release.

## Testing

- Vitest. Every usecase gets unit tests (repos mocked via interfaces). Routes tested with `fastify.inject`.
- Every plan's acceptance criteria get at least one automated test where feasible; manual steps go in the PR description.
- A "kill test" (SIGINT mid-operation, restart, assert no corruption) is required for any plan touching storage.
- **A new client page ships with a journey** in `e2e/browser/` that declares its route with `routes('/the/path')` (written literally). `routes.spec.ts` reads `App.tsx` as text and fails CI for any route no journey names (PLAN-32a). A `needsHub: false` feature also needs a journey in `e2e/standalone/` naming its root, because `routes.spec.ts` checks `features.ts` per build (PLAN-35).
- `npm run test:e2e` must stay green after `npm run build` and `./bifrost build --standalone`. A failure there is a client break, never a flake to retry. A bug the net finds that is out of a PR's scope is pinned with `test.fail(…)` and a comment naming it, never skipped; the pin comes out in the PR that fixes it. See `docs/testing.md`.

## Repo tasks (`./bifrost`)

- **Every repo task runs through `./bifrost`** (`scripts/bifrost/commands.ts`, one table): `./bifrost help` lists them, `./bifrost help <cmd>` shows what each runs, `./bifrost list --json` gives the whole table. Reach for it before reading a `package.json`.
- **A new script or workflow gets a row in that table in the same change**, with examples. A command only plans an existing npm or shell script; logic stays in that script. `scripts/bifrost/commands.test.ts` plans every example and fails on any npm script, file or compose file that does not exist, and keeps `docker config` equal to CI's compose list.
- **Root `package.json` keeps only what npm, CI, husky and muscle memory need** (`setup dev build start test lint typecheck backup restore api:spec test:e2e test:load prepare`). Variants are flags or subcommands of `./bifrost`, not new root scripts.
- Not the `bifrost` LAN client: that is `cli/`, installed globally. `./bifrost` needs the checkout and never ships.

## Frontend

- Design tokens/themes only via CSS custom properties — never hardcode colors in components.
- Hub/portal cards get their color from the **10-slot card palette** (`--card-1..10`, class `.card-tone-N`). Colour follows **position, per page**: build the grid from an ordered array and render with `cardToneClass(index + 1)` (`core/ui/cardTone.ts`, wraps after 10). Never hand-pick a card color, write a literal `card-tone-N` string, or pass a fixed number — derive from the render index so reordering recolours. Each theme defines its own 10 hues in `client/src/assets/themes/*.json`.
- Responsive-first: layouts verified at 375px, 768px, 1280px.
- No `localStorage` for critical state; server is the source of truth. Allowed non-critical class (per decision log): theme-choice cache, `deviceId`, relic-collection prefs, draft buffers, and the standalone site's own settings under `bifrost.local.*` (PLAN-35: one browser's preferences with nothing to sync to, read only through `LocalSettingsStore`, which validates every field).
