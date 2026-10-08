# PLAN-35 — Client decoupling: hub and standalone builds

## Goal

Today the client cannot draw a single page without the server. Each of these comes from the server:

- its navigation (`GET /api/capabilities`);
- its themes (`GET /api/themes`);
- every editor's size cap (`GET /api/<kind>/config`);
- a live-updates connection (`/api/events`) it opens on every page.

Its error logging posts back to the server, and every request is a same-origin relative URL. So even the tools that compute entirely in the browser (the Diagon Alley toolbox, Variant, Loki, the editors while editing, Saga on a dropped file) are unusable without a running hub.

This plan makes the client **know what it ships instead of asking**, and splits it into two builds of one codebase:

- **hub**: the app `bifrost.local` serves today, with every feature, talking to the local server exactly as now.
- **standalone**: a static site that runs as a **Docker container** on the owner's cloud machine (a Hostinger VPS), beside the other containers already running there, with only the features that need no server. It **never contacts any server**: no API call, no live updates, no log upload.

Themes become client code (`client/src/assets/themes/`), and the theme upload/management API is deleted. Editor size caps come from the env file at build time. Heimdall exists in both builds:
- **standalone:** device-local settings only;
- **hub:** everything it does today.

Whenever a page reaches for something that needs the hub and cannot have it, a single themed sheet says so ("The Bifröst is closed"). Running the hub's client and server on separate ports is the next plan, PLAN-36. The literal name is the name.

## Gate

PLAN-34 merged. Single PR, no parts. **The sequence is linear: 32 → 33 → 34 → 35 → 36** (owner's instruction). This plan therefore lands on a codebase that already has:
- PLAN-32's response schemas, contract guard, committed `server/openapi.json` and e2e net;
- PLAN-33's spec-driven API suites;
- PLAN-34's load harness.

It **rewrites whatever testing logic it touches**, also at the owner's instruction:
- the hub journeys that exercise the Themes section or `/api/capabilities`;
- the server tests and schemas of the ten routes it deletes;
- any `e2e/` code that names those routes.

PLAN-34 has already deleted the old-vs-new API diff tool, so "nothing else changed" is proven another way (below).

**Merge condition:**
- `npm test` (contract guard on);
- the full `npm run test:e2e`: the hub journeys rewritten only where this plan deliberately changes behaviour, the Vitest CLI and API suites, and this plan's new `standalone` Playwright project;
- **the committed `server/openapi.json` diff** against `develop`: every difference must be one of the ten removed operations or the one listed additive change (`defaultThemeId` on `/api/heimdall/access`, see Themes). This is checked by a test, so it does not rest on someone reading the diff. The test is written as "every difference is allowed", so an empty diff (after the merge, when `develop` already has the new spec) passes rather than breaking `develop`. CI fetches `develop` explicitly, so the check never silently skips there. PLAN-37 replaces it with its general "no v1 operation removed" rule and deletes it.


## Verified against the codebase, not assumed

- **Nav needs the server:** `client/src/core/useCapabilities.ts` fetches `/api/capabilities` on mount; `App.tsx:190` filters nav by `capabilities.modules`; the Midgard/Ollivanders/Diagon Alley hub pages read the same hook. On failure the hook only stores an error string.
- **Themes need the server:** `client/src/core/theme.ts`:
  - fetches `/api/themes` (the listing plus `defaultId`) and `/api/themes/:id` (resolved tokens);
  - listens for the `theme.updated` SSE event;
  - caches the applied tokens in `localStorage['bifrost.theme.cache']` for the `index.html` FOUC replay.

  Heimdall's Themes section uses `/api/themes/manage` and `PATCH /api/themes/:id` (enable/disable), and its Settings section picks a default theme from `/api/themes`.
- **The server themes module** (`server/src/modules/themes/`, ~1,450 lines incl. tests) includes:
  - an fs store and watcher over `THEMES_DIR` (default `./themes`);
  - ajv validation against `theme-schema.ts`;
  - `resolve.ts`, which fills defaults;
  - `contrast.ts`, the WCAG warnings;
  - `DbThemeVisibilityStore` (the `themes.disabled` row in the `settings` table, not a table of its own);
  - six routes: `GET /api/themes`, `POST /api/themes`, `GET /api/themes/manage`, and `GET`/`PATCH`/`DELETE /api/themes/:id`.

  The default theme is Heimdall's `defaultThemeId` (settings key `themes.default`, validated `^[a-z0-9-]{2,32}$`).
- **Seven built-in themes** live in the repo-root `themes/`: aurora, daybreak, ghibli-dusk, gryffindor, olympus, slytherin, tokyo.
- **Other references to `themes/`:**
  - `scripts/backup.ts` and `scripts/restore.ts` + `core/backup` (archives include `themes/`);
  - `README.md`, `project-structure.md`, `docs/THEME-SPEC.md`;
  - the `theme` skill (`.claude/skills/theme/SKILL.md`);
  - `.env.example`'s `THEMES_DIR`.

  The owner does not use theme upload.
- **Editor caps need the server:** `client/src/core/{runestone,edda,groot,atlas}.ts` fetch `/api/<kind>/config` → `{ maxDocKb }` (Edda also `livePreviewMaxKb`). The server keys are `RUNESTONE_MAX_DOC_KB`, `EDDA_MAX_DOC_KB`, `EDDA_LIVE_PREVIEW_MAX_KB`, `GROOT_MAX_DOC_KB`, `ATLAS_MAX_DOC_KB`. The server still enforces each cap on save. `client/vite.config.ts` already reads the repo-root `.env` (for `PORT`).
- **Live updates:** `App.tsx:229` calls `bifrostEvents.connect()` on mount (`core/sse.ts` → `new EventSource('/api/events?…')`). Screensaver and offline-mode settings also arrive over SSE.
- **Logging:** `client/src/core/log.ts` fetches `/api/client-logs/config` and batches to `POST /api/client-logs`.
- **Every request is relative:** `core/api.ts` `apiGet`/`apiSend` call `fetch(path)`. A refused or unreachable server surfaces as a thrown `TypeError` (or `AbortError` on `timeoutMs`), distinct from `ApiError` (an HTTP status).
- **Loki's run gate:** `LokiPage.tsx:150` uses `capabilities?.profile === 'local' && lokiConfig?.executionEnabled`. decisions.md 2026-07-21 logged that the runner is "never reachable in cloud". Its policy comes from `/api/loki/config` (`LOKI_*` keys).
- **Heimdall** (`client/src/features/heimdall/`):
  - it opens by shortcut or taps, read from `/api/heimdall/access` (`HEIMDALL_SHORTCUT_DEFAULT`, `HEIMDALL_TAP_COUNT`);
  - the PIN is checked by `POST /api/heimdall/login`;
  - its sections are Overview, Activity, Wardens, Settings (shortcut, tap count, default theme, revoke), Themes, Sky Relics, Loki, Screensaver, Offline mode, Storage, Uploads, Network, About;
  - Sky Relics already persists in `localStorage` (`core/relicPrefs.ts`).
- **The CLI reads `/api/capabilities`** (`cli/src/commands/status.ts`, `doctor.ts`), and an installed CLI can be older than the server. No CLI command uses themes or the editor config routes.
- **PLAN-22's offline mode** already has `ui/RouteBoundary` (a cold route with no server shows an inline panel, not the crash card) and `core/chunkError.ts`.
- **The coding rules** allow `localStorage` only for non-critical state (theme choice, `deviceId`, relic prefs, drafts).

## Scope

**In:**
- Two client builds:
  - `npm run build` (hub, unchanged output path);
  - `npm run build:standalone` → `client/dist-standalone/`;
  - a `standalone` target in the `Dockerfile` that builds it and serves it from a small, non-root static server, plus `docker-compose.standalone.yml` to join the owner's existing container setup.
- A client-side feature manifest per build, replacing `/api/capabilities` for the client.
- Themes moved to `client/src/assets/themes/`; theme validation as a test; the server themes module, its six routes, `THEMES_DIR` and the `theme.updated` event deleted; backup/restore stop archiving `themes/`.
- Editor caps from the env file at build time; the four editor `/config` routes deleted.
- Standalone:
  - no SSE, no client-log upload (a no-op sink with a seam for a later log service);
  - Loki on build-time defaults;
  - Heimdall with device-local sections only.
- The "Bifröst is closed" sheet and a central hub-unreachable path in `core/api.ts`.
- A `standalone` Playwright project.

**Out:**
- Running the container on the cloud machine: the owner does that with the compose file and `docs/standalone.md`. TLS and the public hostname belong to the reverse proxy already running there, not to this container.
- Plain static hosting (uploading files, `.htaccess`): the owner runs everything in Docker, so it is not supported or tested.
- Sending standalone logs to a service (Docker on Hostinger): a PLAN-99 row; this plan only leaves the sink seam.
- **Any server call from the standalone build, ever**, and therefore CORS. The hosted site never talks to the hub.
- Changing the server's `DEPLOY_PROFILE`/`MANIFEST`: it stays as the server's security boundary.
- Removing `/api/capabilities`: the CLI still uses it.
- Theme upload in any form.

## Decisions & reasoning

### The client knows what it ships; the server decides what it exposes

`client/src/core/features.ts` declares each feature once (in `core/`, not `app/`, because Heimdall is a feature and features may import only `core/`; eslint-plugin-boundaries enforces it): its id, route roots, nav category, and `needsHub: boolean`. `HUB_FEATURES` is all of them. `STANDALONE_FEATURES` are those with `needsHub: false`:

- the Diagon Alley toolbox, minus the server-URL QR in Sigil;
- Variant;
- Loki;
- Runestone, Edda, Groot and Atlas as editors (no library);
- Saga on a dropped file;
- the guide panel.

A build-time constant (`__BIFROST_BUILD__`, `'hub' | 'standalone'`, from the Vite mode) picks the list. Nav, hubs, routes and Heimdall sections all read it. A category tab still shows only when one of its features is present, so standalone has no Midgard tab.

The server's `MANIFEST` is untouched and is not replaced by this. It answers a different question: what may be **reached** on a given server, which is a security boundary a client build can never be. A client that hides upload does not stop anyone calling an upload route directly. `/api/capabilities` therefore stays for the CLI (`bifrost status`, `doctor`) and anything else that wants it. The client simply stops calling it. The hub build targets the `local` server profile. A hub build pointed at a `cloud`-profile server is not a supported pairing and is documented as such.

### ⚠️ The standalone build cannot reach a server, by construction

The owner's rule: the hosted site never calls the server. Discipline is not enough: one forgotten `fetch` in a shared component would break it. So in the standalone build, `core/api.ts`'s `apiGet`/`apiSend`, `core/sse.ts`'s `connect`, and `core/log.ts`'s upload are **compiled to stubs** behind `__BIFROST_BUILD__`:
- the request functions throw `HubUnavailableError` without touching the network;
- SSE never opens;
- logs go to a no-op sink.

Vite's dead-code elimination drops the real paths from the bundle.

Two tests prove it:
- a build check greps `dist-standalone/` for `/api/`, `EventSource` and `/go/`, and fails on any hit outside the stub's own message strings;
- the `standalone` Playwright project fails on **any** request that is not a static asset from its own origin.

CORS never comes into it, and neither does the https → http mixed-content block or Chrome's public → private network block. A page that makes no request cannot be blocked.

### "The Bifröst is closed": one sheet, two triggers

`core/ui/BridgeClosed.tsx` is a single sheet in the existing notification styling and theme tokens, with a small Heimdall-at-the-gate illustration:

> **The Bifröst is closed**
> This needs your Bifrost hub, and the bridge to it isn't open from here.
> *[Download instead]* · *[Try again]* · *[Okay]*

- **Standalone:** hub-only *pages* are absent from the nav. A deep link to one (e.g. `/hermes`), or to a server path the container's fallback hands to the app (`/go/<slug>`, `/api/…`, `/<kind>/api/…`), renders the sheet as the page body instead of a 404. Hub-only *actions* on standalone pages open it:
  - an editor's Save, Open from library, "API"/"Copy curl";
  - Saga's "present a saved Edda";
  - the editors' Brotli hand-off.

  "Download instead" appears wherever a local alternative exists: an editor saves the document as a file, which is also its standalone answer to "save". "Try again" is hidden here, because there is nothing to try.
- **Hub with the server down:** `core/api.ts` maps a network-level failure (`TypeError`, or `AbortError` from `timeoutMs`; never an `ApiError`, since a 4xx/5xx means the server *answered*) to `HubUnreachableError`. A global handler shows the same sheet with "Try again". The sheet closes itself when SSE reports `'open'` again. Repeated failures while it is open do not stack sheets.

PLAN-22's `RouteBoundary` stays responsible for chunk-load failures. The sheet is for API calls, so the two never overlap.

### Themes are client code

The seven JSON files move to `client/src/assets/themes/`, beside fonts, relics and guides, and are imported with `import.meta.glob(…, { eager: true })`. Resolving defaults moves from the server's `resolve.ts` to `client/src/core/theme/resolve.ts`. The token defaults are the same, ported rather than reinvented, and verified by porting `theme-validation.test.ts`'s cases.

Validation (`theme-schema.ts`) and the contrast warnings move into a **client unit test** that validates every file in the folder, because a theme is now code and bad code should fail CI, not render. This keeps ajv out of the shipped bundle. `ThemeEngine` loses its network paths and its `theme.updated` listener. The cache and the FOUC replay are unchanged, so first paint behaves exactly as before.

**Deleted:**
- the whole `server/src/modules/themes/` module, its six routes and its manifest entries;
- `THEMES_DIR`;
- the `theme.updated` bus/SSE event;
- Heimdall's Themes section and its client API calls.

The orphaned `themes.disabled` settings row is removed by a one-line SQL migration (`db-migration` skill), not left behind.

**Kept: Heimdall's "Default theme"** in the hub build, because the owner wants the hub's Heimdall to "work as present". It still writes `themes.default` on the server. The server can no longer check the id against a list it does not have, so it validates the pattern only (as `config` already does), and the client ignores an unknown id via `resolveThemeChoice`'s existing fallback. In standalone, the same control sets a device-local default.

⚠️ **The household default must stay readable by every device.** Today a non-admin device learns it only from the public `GET /api/themes` listing (`defaultId`), because `GET /api/heimdall/settings` is admin-only. Deleting `/api/themes` without a replacement would silently drop the default on every device. So the public `GET /api/heimdall/access`, which every device already fetches for the open gesture, gains `defaultThemeId`. This is an additive field, the only one this plan adds to an existing response. `ThemeEngine` reads it there in the hub build.

Backup and restore stop archiving `themes/`, because themes are in git now. Restore **skips** a `themes/` folder found in an older archive, logging that it did so, rather than failing on it. The `theme` skill, `docs/THEME-SPEC.md`, `README.md` and `project-structure.md` are updated to the new location.

### Editor caps come from the env file at build time, one number shared with the server

`vite.config.ts` already loads the repo-root `.env`. It now also reads `RUNESTONE_MAX_DOC_KB`, `EDDA_MAX_DOC_KB`, `EDDA_LIVE_PREVIEW_MAX_KB`, `GROOT_MAX_DOC_KB` and `ATLAS_MAX_DOC_KB`, and injects them with `define`. A missing key falls back to the same default `.env.example` documents.

These are **the same keys the server enforces**, deliberately. Two separate numbers (a `client/.env` and the server's) would drift, and a client allowing 3 MB against a server refusing at 2 MB turns every large save into a 413. The server keeps enforcing the cap. The client only shows it and pre-checks it. The four `/api/<kind>/config` routes are deleted, because nothing else reads them. A changed cap needs a client rebuild, which the docs and `.env.example` say next to each key.

⚠️ **A rebuild that is forgotten must be visible, not silent.**
- The hub build writes the caps it baked in to `client/dist/bifrost-build.json`.
- At boot, the server reads that file (it already knows `client/dist`) and logs a `warn` naming each key whose `.env` value differs, for example "client built with RUNESTONE_MAX_DOC_KB=2048, server enforces 1024 — rebuild the client". The server still enforces its own number, so a drift only costs a late 413, never a bypass.
- `Dockerfile` passes the five keys as build `ARG`s, because an image builds the client without the runtime `.env` and would otherwise always bake in the defaults.

### Standalone Heimdall: device-local settings, no PIN

Without a server there is nothing to verify a PIN against. A PIN checked in the browser is theatre, because anyone can edit `localStorage`. So standalone Heimdall opens by the same shortcut and taps as the hub, with **no PIN**, and every value lives in this browser only. The header says so: "These settings live in this browser."

| Section | Standalone | Hub |
|---|---|---|
| Overview, Activity, Wardens, Storage, Uploads, Network | absent | as today |
| Settings | Theme for this browser; how Heimdall opens here (shortcut, tap count) | as today (shortcut, taps, default theme, revoke) |
| Themes (enable/disable) | absent | **deleted** (management API gone) |
| Sky Relics | as today (already device-local) | as today |
| Loki | this device's run policy (execution, fetch, timeout, console budget) | as today (server policy) |
| Screensaver | this device's Nótt settings | as today (server policy) |
| Offline mode | absent (a static site has nothing to warm against) | as today |
| About | client build info (version, commit, build) | as today |

The shortcut and tap count, and the Loki and Nótt values, start from the `HEIMDALL_SHORTCUT_DEFAULT`/`HEIMDALL_TAP_COUNT`, `LOKI_*` and `SCREENSAVER_*` env defaults baked in at build time. A browser's changes are stored in `localStorage` under `bifrost.local.*`. That is a new entry in the allowed non-critical class: they are this browser's preferences with nothing to sync to.

**There is no "default theme" in standalone.** On the hub it means "the household default for every device". In one browser it would be identical to choosing a theme, so standalone shows only the theme choice, which already lives in `localStorage` (`bifrost.theme`).

**What a setting applies to is visible.** The standalone panel's header reads "These settings live in this browser". Hub sections keep their current wording, because there the settings apply to the whole household and reach every device live.

### One settings layer, two stores, so Heimdall is written once

Today every Heimdall section calls the server directly (`features/heimdall/api.ts`, `core/screensaver.ts`, `core/loki.ts`, `core/offlineMode.ts`). Giving standalone its own copies of those sections would fork them, and the copies would drift. So `client/src/core/settings/` defines a `SettingsStore<T>` interface (`load()`, `save(patch)`, `subscribe(listener)`) with two implementations, chosen by `__BIFROST_BUILD__`:

- **`HubSettingsStore`**: the existing API calls, plus the existing SSE events for live updates. This is behaviour-identical to today, and the hub journeys prove it.
- **`LocalSettingsStore`**: `localStorage` under `bifrost.local.<area>`. It also listens to the browser's `storage` event, so two tabs of the standalone site stay in step.

The Screensaver, Loki and Settings sections, and the code that reads those settings at runtime (Nótt's overlay, Loki's run gate, the open gesture), are written once against the interface.

⚠️ **What comes back from `localStorage` is untrusted.** It can be an older format, a hand-edited value, or nothing at all: Safari's private mode throws on access, and storage can be cleared. So `LocalSettingsStore`:
- validates every read against the **same rules the server applies** (e.g. idle seconds and console budget within their ranges, enum values only). The rules are ported to `core/settings/rules.ts` and kept in step with the server's by a shared table of cases that both test suites run;
- falls back to the build-time defaults, per field, for anything missing or invalid;
- wraps every access in `try/catch`, so a throwing `localStorage` means "use the defaults" and never a crash;
- stores `{ v: 1, values: … }`, so a future format change migrates old values rather than silently resetting them.

### Loki works on whatever it has

- **Hub:** policy from `/api/loki/config` as today. The run gate becomes `__BIFROST_BUILD__ === 'hub' && lokiConfig.executionEnabled`, replacing `capabilities.profile === 'local'`, since the client no longer fetches capabilities.
- **Standalone:** transforms and the regex tester work fully. The Calcifer runner follows the device-local policy (seeded from `LOKI_EXECUTION_ENABLED`/`LOKI_FETCH_ALLOWED` at build time). ⚠️ **This supersedes decisions.md 2026-07-21's "runner never reachable in cloud".** That rule protected a *server* exposed to the internet. On the standalone site a run is the visitor's own code in their own browser's Web Worker, touching no server of the owner's, which is the same threat model the original decision judged the worker sufficient for. The owner can still ship the site with the runner off by setting `LOKI_EXECUTION_ENABLED=false` for that build.

### Logs: off in standalone, with a seam for the future service

`core/log.ts` gets a `LogSink` interface:
- **hub:** `HttpSink`, the current batching to `/api/client-logs`, unchanged;
- **standalone:** `NoopSink`.

A later plan adds a sink that posts to a log service the owner runs in Docker on Hostinger, a server of *that* site's own. It touches one file. A PLAN-99 row records it.

### The standalone build runs in Docker, beside the owner's other containers

The owner's cloud machine runs everything in Docker, so the standalone site is a container, not uploaded files:

- **One `Dockerfile`, a new `standalone` target.**
  - A `standalone-build` stage installs and builds **only the client workspace**, so it needs none of the server's native toolchain (`better-sqlite3`, `python3`, `g++`). The first task verifies that `npm ci` scoped to the workspace really does skip them.
  - The final stage is `nginxinc/nginx-unprivileged` (alpine, pinned): non-root, listening on 8080, with `dist-standalone/` as its only content.
  - The existing hub targets are untouched.
- **The setting is a build argument.** The target fixes `BIFROST_BUILD=standalone` itself. The cap, Loki, Nótt and Heimdall-access defaults are `ARG`s with the `.env.example` defaults, so the owner overrides them in the compose file's `build.args`. Vite inlines values at build time, so a runtime `ENV` or `docker run -e` would arrive too late, and `docs/standalone.md` says so plainly.
- **`nginx.conf`, committed:**
  - `try_files $uri /index.html`, so deep links survive a refresh, and `/api/…`, `/go/…` and `/<kind>/api/…` land on the app, which shows the Bifröst sheet;
  - long-cache immutable headers for hashed `/assets/`, and `no-cache` for `index.html`;
  - `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`;
  - `server_tokens off`;
  - **no `proxy_pass` anywhere**, so even the web server cannot reach a backend;
  - a `HEALTHCHECK` on `/` in the image.
- **`docker-compose.standalone.yml`** runs one service, `bifrost-standalone`, with:
  - `restart: unless-stopped`, `read_only: true` (plus the `tmpfs` paths nginx needs), and `cap_drop: [ALL]`;
  - **no published port by default**: it `expose`s 8080 and joins an external network named by `BIFROST_DOCKER_NETWORK`, so the reverse proxy already on the machine routes the public hostname and TLS to it. A commented-out `ports:` line covers a machine without a proxy.

  Nothing in it collides with the owner's other containers: no host port, no fixed container name, and no shared volume.
- **`.htaccess` is not generated.** Docker is the only supported way to run it.
- **The future log service** (PLAN-99) becomes another container on the same network, with its own URL configured at build time. That is the seam `LogSink` already leaves.

CI's existing Docker job also builds the `standalone` target and smoke-tests it: run the image, then check that `/`, a deep link and a hashed asset answer with the right status and cache headers, that `/api/health` returns the app shell rather than a proxied response, and that the healthcheck passes. That keeps the image honest the same way the hub image already is.

## API contracts

| Method & path | Change | Notes |
|---|---|---|
| `GET/POST /api/themes`, `GET /api/themes/manage`, `GET/PATCH/DELETE /api/themes/:id` | **Removed** (404) | Themes are client code. Their schemas leave `openapi.json` |
| `GET /api/{runestone,edda,groot,atlas}/config` | **Removed** (404) | Caps come from the env file at build time. Their schemas leave `openapi.json` |
| `PATCH /api/heimdall/settings` `defaultThemeId` | Validation narrows to the id pattern | No list to check against; unknown ids fall back on the client |
| `GET /api/capabilities` | **Unchanged** | Still served for the CLI; the client no longer calls it |
| SSE `theme.updated` | **Removed** | Nothing emits or listens |

Everything else is unchanged. The server goes from 95 routes to 85; `npm run api:spec` regenerates `server/openapi.json`, and PLAN-32's coverage test and PLAN-33's spec-driven suites follow the new spec automatically.

## Task checklist

**Client: build split**
- [x] `vite.config.ts`: `standalone` mode → `outDir: dist-standalone`; `define` `__BIFROST_BUILD__` and the five cap keys plus the Loki/Nótt/Heimdall-access defaults from the root `.env`; no `.htaccess` (Docker serves it)
- [x] `client/package.json` + root: `build:standalone`; `client/src/vite-env.d.ts` declares the constants
- [x] `client/src/core/features.ts`: the manifest (`needsHub`), `HUB_FEATURES`, `STANDALONE_FEATURES`; `App.tsx` and the three hub pages read it; `useCapabilities.ts` and `fetchCapabilities` deleted
- [x] `core/api.ts`: `HubUnreachableError` (network failure) and `HubUnavailableError` (standalone stub); standalone stubs; `core/sse.ts` standalone no-op; `core/log.ts` `LogSink` (`HttpSink`/`NoopSink`)
- [x] `core/ui/BridgeClosed.tsx` + global handler (no stacking, auto-close on SSE `'open'`); standalone route fallback for hub-only paths; "Download instead" wiring in the four editors and Saga

**Client: themes, caps, Loki, Heimdall**
- [x] `client/package.json`: `ajv` as a devDependency (test-only; never in the bundle)
- [x] `git mv themes/*.json client/src/assets/themes/`; `core/theme/resolve.ts` (ported); `ThemeEngine` without network or SSE; `core/theme/themes.test.ts` (schema + contrast for every file; resolve parity cases ported from the server test)
- [x] `core/{runestone,edda,groot,atlas}.ts`: caps from constants; config fetches deleted
- [x] `LokiPage.tsx`: build-based gate; standalone device-local policy
- [x] Heimdall: standalone opens without a PIN with the sections in the table; hub loses the Themes section; Settings' default-theme options come from the bundled themes; device-local stores for Loki/Nótt (`bifrost.local.*`)

**Server**
- [x] Delete `modules/themes/` and its `MANIFEST` entries; `THEMES_DIR` from config and `.env.example`; `theme.updated` from `core/bus/events.ts`
- [x] Delete the four editor `/config` routes; keep `/api/capabilities`
- [x] Heimdall `defaultThemeId`: pattern-only validation
- [x] Migration deleting the `themes.disabled` settings row (`db-migration` skill: upgraded and fresh DB)
- [x] `core/backup`, `scripts/backup.ts`, `scripts/restore.ts`: no `themes/`; restore skips and logs an old archive's `themes/`
- [x] Tests: `app.test.ts` module list, `themes.int.test.ts` deleted, backup/restore tests, Heimdall settings test

**Tests (e2e, extends PLAN-32/33)**
- [x] `e2e/playwright.config.ts`: `standalone` project serving `dist-standalone/` from a small static server with the same fallback rules as the committed `nginx.conf` (a unit test checks the two rule sets agree); the no-request guard (only same-origin static assets)
- [x] Standalone journeys: every standalone feature works; every hub-only action and deep link shows the sheet; "Download instead" saves a file; Heimdall opens without a PIN and persists per device; themes switch with no request
- [x] Hub journeys: adjusted only for the removed Themes section; added: stop the server mid-session → sheet with "Try again" → restart → sheet closes, action succeeds
- [x] Build check: no `/api/`, `EventSource` or `/go/` in `dist-standalone/` outside the stub messages
- [x] `npm run api:spec`; `server/src/openapi-removals.test.ts` reads `develop`'s `server/openapi.json` (`git show`; `ci.yml` fetches `develop` so it never skips there) and asserts **every** difference is one of the ten removals or the `defaultThemeId` addition (an empty diff passes)
- [x] Rewrite the testing logic this plan touches: hub journeys for the Themes section and capabilities-driven nav; the deleted routes' server tests and schemas; any `e2e/` (journeys, API suites, `e2e/perf/` scenarios) naming a removed route (`grep` for each path)
- [x] PLAN-32's `cloud` Playwright project: it asserted that nav hides local-only pages because the **server** said so. After this plan the nav comes from the client build, so that assertion no longer holds and a hub build against a cloud-profile server is unsupported. The project is rewritten as a Vitest API check that a `cloud`-profile server still refuses (404) every local-only route, which is the security half that still matters
- [x] PLAN-32's `routes.spec.ts` reads route roots from `client/src/core/features.ts` (where they now live) instead of `App.tsx`, still as text
- [x] Standalone stub call counter: in the standalone build each stub records its calls. A Playwright check cold-loads every standalone page and asserts **zero** stub calls and no sheet until the user acts. The network guard alone cannot see this, because stubs never touch the network
- [x] `client/dist/bifrost-build.json` + server boot warning on cap drift; `Dockerfile` build `ARG`s for the five caps
- [x] `/api/heimdall/access` gains `defaultThemeId` (schema, `npm run api:spec`); `ThemeEngine` reads it

**Docs & cleanup**
- [x] `Dockerfile` `standalone` target (client-only build stage, `nginx-unprivileged` final stage, build `ARG`s), committed `nginx.conf`, `docker-compose.standalone.yml` (external network, no published port, read-only, `cap_drop`), CI build + smoke test of the target
- [x] `client/src/core/settings/`: `SettingsStore`, `HubSettingsStore`, `LocalSettingsStore`, `rules.ts` + the shared server/client rule cases; Screensaver, Loki and Settings sections, Nótt, Loki's gate and the open gesture moved onto it
- [x] `docs/standalone.md` (the build args, the compose file, joining an existing reverse-proxy network, updating the container, verifying it); `docs/THEME-SPEC.md`; `README.md`; `.claude/skills/theme/SKILL.md` (new path; validation is the client test)
- [x] `architecture.md` (two builds, the feature manifest vs the server `MANIFEST`, the sheet), `project-structure.md`, `coding.md` (the `bifrost.local.*` localStorage class; new features declare `needsHub`), `tech-stack.md`
- [x] PLAN-99 row: standalone client logs → a log service (another container on the same Docker network)
- [x] `decisions.md`, `progress.md`; archive this file into `completed/` in the PR
- [x] Cleanup: the old repo-root `themes/` folder is gone; no probe scripts committed; no worktree or scratch data left; the PR lists deletions

## Acceptance criteria

1. `docker compose -f docker-compose.standalone.yml up` builds and runs the standalone site as a non-root container, healthy, with no published port by default. Through it, every standalone feature works and a refresh on any deep link loads the app.
2. The standalone build makes **zero** requests other than same-origin static assets in any journey, and its bundle contains no `/api/`, `EventSource` or `/go/` outside the stub messages.
3. In standalone, hub-only pages are absent from the nav, a deep link to one shows "The Bifröst is closed", and every hub-only action opens the sheet. Where a local alternative exists, "Download instead" works.
4. In the hub build with the server stopped, any server action shows the sheet with "Try again". When the server returns, the sheet closes and the action succeeds. Sheets never stack.
5. The hub build passes every PLAN-32 journey, rewritten only for the removed Themes section and capability-driven nav, and makes no request to `/api/capabilities`, `/api/themes*` or `/api/<kind>/config`.
6. Themes load from the bundle with no request; all seven validate and pass contrast in the client test; first paint uses the cached theme as before; the repo-root `themes/` and the server themes module no longer exist.
7. Editor caps shown in the UI equal the `.env` values the server enforces, and a document over the cap is refused on the client before any request.
8. Standalone Heimdall opens by shortcut and taps without a PIN, shows only the device-local sections, and persists them per device. Hub Heimdall works as before, minus the Themes section, with "Default theme" still household-wide.
9. Loki transforms and regex work in both builds. The runner follows server policy in the hub and device-local policy in standalone.
10. `bifrost status` and `bifrost doctor` still work, so `/api/capabilities` is unchanged.
11. Backup no longer archives `themes/`; restoring an older archive that contains one succeeds and logs the skip.
12. `server/openapi.json` differs from `develop`'s only by the ten removed operations and the additive `defaultThemeId` on `/api/heimdall/access`, asserted by `openapi-removals.test.ts`, and PLAN-32's coverage test and PLAN-33's API suites pass on the new spec.
13. A non-admin device in the hub build applies the household default theme set in Heimdall (read from `/api/heimdall/access`), exactly as before this plan.
14. Cold-loading any standalone page makes zero stub calls and shows no sheet; the sheet appears only after a hub-only action or on a hub-only deep link (including `/go/<slug>`).
15. A hub build whose baked caps differ from the server's `.env` logs a boot warning naming each key.
16. Standalone Heimdall's settings persist per browser, sync across two tabs, and survive a corrupted, old-format or missing `localStorage` value (each field falls back to its build-time default, with no crash), including Safari private mode.
17. The hub's Heimdall behaves exactly as before on the shared `SettingsStore` layer: every PLAN-32 Heimdall journey passes unchanged.
18. CI builds the `standalone` image and its smoke test passes: shell, deep link, asset cache headers, `/api/health` serves the app shell (no backend), healthcheck.

## Test checklist

**Unit (client)**
- [x] `core/theme/themes.test.ts`: every bundled theme validates and passes contrast; resolve parity with the ported server cases
- [x] `core/features.test.ts`: standalone list = `needsHub: false`; every route root in `App.tsx` belongs to exactly one feature
- [x] `core/api.test.ts`: network failure → `HubUnreachableError`; HTTP error → `ApiError`; standalone stub throws without calling `fetch`
- [x] `core/log.test.ts`: `NoopSink` sends nothing; `HttpSink` unchanged
- [x] `BridgeClosed` component: no stacking, auto-close, button sets per context
- [x] `core/settings/LocalSettingsStore.test.ts`: round trip; corrupted JSON, out-of-range and old-format values fall back per field; a throwing `localStorage` uses defaults without crashing; the `storage` event syncs a second instance; `v1` → future-version migration hook (criterion 16)
- [x] `core/settings/rules.test.ts` + the server's matching test: both run the same table of cases (criterion 16)
- [x] Static-server fallback rules in the e2e harness match `nginx.conf` (criterion 18)

**Unit / integration (server)**
- [x] `app.test.ts` module list without `themes`; removed routes 404; `/api/capabilities` unchanged
- [x] Heimdall `defaultThemeId` pattern validation
- [x] Migration on an upgraded and a fresh DB; backup without `themes/`; restore skipping an old archive's `themes/`

**Docker**
- [x] CI: build the `standalone` target, run it, smoke-test shell / deep link / asset headers / `/api/health` → app shell / healthcheck (criteria 1 and 18)

**End-to-end**
- [x] `standalone` project: criteria 1–3, 8 and 9
- [x] Hub projects: criteria 4, 5 and 7
- [x] CLI suite unchanged and green (criterion 10)
- [x] `openapi-removals.test.ts` + the Vitest API suites (criterion 12)

**Manual**
- [ ] The owner runs the compose file on the cloud machine behind the existing reverse proxy and opens a deep link and a refresh there; on a real iPhone and iPad, the standalone site and the hub
