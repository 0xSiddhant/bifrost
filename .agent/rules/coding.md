# Coding Rules

## Boundaries (build-failing, via eslint-plugin-boundaries)

- `core/` never imports from `modules/`. Modules never import from other modules — communicate via the core event bus only.
- Usecases import repository/service **interfaces**, never Drizzle, `fs`, chokidar, or fetch directly.
- Client `features/` mirror the same rule: no cross-feature imports; shared code goes in `client/src/core`.

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

## Testing

- Vitest. Every usecase gets unit tests (repos mocked via interfaces). Routes tested with `fastify.inject`.
- Every plan's acceptance criteria get at least one automated test where feasible; manual steps go in the PR description.
- A "kill test" (SIGINT mid-operation, restart, assert no corruption) is required for any plan touching storage.

## Frontend

- Design tokens/themes only via CSS custom properties — never hardcode colors in components.
- Hub/portal cards get their color from the **10-slot card palette** (`--card-1..10`, class `.card-tone-N`). Colour follows **position, per page**: build the grid from an ordered array and render with `cardToneClass(index + 1)` (`core/ui/cardTone.ts`, wraps after 10). Never hand-pick a card color, write a literal `card-tone-N` string, or pass a fixed number — derive from the render index so reordering recolours. Each theme defines its own 10 hues in `themes/*.json`.
- Responsive-first: layouts verified at 375px, 768px, 1280px.
- No `localStorage` for critical state; server is the source of truth. Allowed non-critical class (per decision log): theme-choice cache, `deviceId`, relic-collection prefs, draft buffers.
