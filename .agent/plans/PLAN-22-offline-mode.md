# PLAN-22 — Offline mode (warm-load for pure-client tools)

## Goal

The owner sometimes has Bifrost open in a browser tab while on the LAN, then
leaves the LAN with the tab still open, and wants the pure-client tools —
Diagon Alley's toolbox and Ollivanders' JSON/YAML/Markdown/diff/JS editors —
to keep working with no server reachable. This plan warms those pages' JS
ahead of time, from a toggle the owner flips before leaving, and makes which
pages participate a Heimdall-configurable policy rather than a hardcoded
list.

**Almost entirely client-side, plus one small server policy module.** The
mechanism that makes an already-open tab keep working is 100% client (an
eager `import()`); the server's only job is remembering which of the six
eligible pages an admin has enabled, the same shape as `screensaver`/`loki`
policy settings.

## Gate

PLAN-21 merged (confirmed against `origin/develop` — PLAN-19, PLAN-20 and
PLAN-21 are all merged as of commit `c7ad790`). **Single PR** —
`feat/plan-22-offline-mode`, no parts.

## Decisions & reasoning

### Why no Service Worker

A Service Worker — the standard way to survive a *reload* or a brand-new tab
offline — only runs in a browser "secure context": HTTPS, or the literal
hostname `localhost`. Bifrost runs plain HTTP on the LAN (`tech-stack.md`:
"HTTPS/HTTP2 deliberately avoided since it's LAN-only" — a deliberate,
logged decision), so a Service Worker would only ever function when opened
as `http://localhost` on the host Mac itself — never from `bifrost.local` or
a LAN IP on another device. This is the same restriction that already hides
the SHA-256 tool on LAN devices (PLAN-18b's `supported()` gate) — a hard
browser limitation, not an engineering gap.

Given that, this plan builds **only** the piece that works everywhere
regardless of device: eagerly resolving (warming) the JS module imports for
these pages while still online, so an **already-open tab** can navigate to
them via client-side routing with zero network, even after the LAN drops. A
Service Worker/offline-reload, a brand-new-tab guarantee, and a standalone
downloadable HTML export were all discussed and explicitly declined for this
plan — they either don't work on non-localhost devices, or solve a different
problem than "the tab I already have open."

This is additive and touches no existing logged decision — it adds no
Service Worker, Cache API, or IndexedDB use, so the 2026-07-22 "no service
worker" decision (`decisions.md`) stands untouched.

### Scope: Diagon Alley's toolbox + Ollivanders' five editors, compute only

Six warmable targets:

- Diagon Alley's toolbox: `client/src/features/toolbox/ToolBody` (the one
  lazy chunk backing all 13 pure-client tools, per PLAN-18).
- Ollivanders' five editors: `RunestonePage`, `GrootPage`, `EddaPage`,
  `VariantPage`, `LokiPage` — their **editing/compute surfaces only**
  (typing, formatting, linting, diffing, live preview, transforms/regex).

Confirmed by direct inspection that each of the five already degrades
gracefully with no server, so no editor needs a fix as part of this plan:

- **Loki**: `fetchLokiConfig()` failure is caught with the existing comment
  "no config → execution just stays hidden; transforms still work"
  (`LokiPage.tsx:159-161`).
- **Runestone/Groot**: silently restore their scratch draft on same-session
  return via `core/draftReturn` (PLAN-19); a genuinely fresh reload prompts
  instead — pre-existing, unrelated to this plan.
- **Edda**: shows a "restore your draft?" banner on every scratch mount
  (`EddaPage.tsx:210-214`) rather than silently restoring — pre-existing,
  left as-is; the data isn't lost, it just needs one click.
- **Variant**: has **no** draft persistence of its own at all — confirmed no
  `localStorage`/draft usage in `VariantPage.tsx`, only a one-shot
  `sessionStorage` cross-tool seed from Loki. Typed content is lost on any
  remount, online or offline. Flagged during discussion; owner declined to
  add persistence here ("this is not needed") — left as a known,
  pre-existing gap, not addressed by this plan.

Loading a **saved** document by slug, and **Pensieve** (which fans out to
three `/api/*` endpoints), correctly need the server and are out of scope —
"only Pensieve won't work" was the owner's own framing, and holds for
saved-by-slug loads on any of the four editors too.

**Page-level granularity, not per-card**: Diagon Alley's 13 tools ship in
one chunk (PLAN-18), so a hypothetical per-card toggle inside it wouldn't
change what's fetched — only page-level entries are real toggles worth
building.

### The registry is Heimdall-configurable, mirroring theme enable/disable

The owner wants a code-owned list (default: all six enabled) that an admin
can narrow from Heimdall, not a fixed client array. The closest existing
precedent is **theme enable/disable**, not a one-off localStorage
preference: `themes.disabled` in the DB `settings` table
(`DbThemeVisibilityStore`), a public listing that hides disabled entries, an
admin PATCH, and a live SSE broadcast so open clients update without a
reload. This plan follows that shape almost verbatim:

- The **registry** (id + label for each of the six targets) is code-owned —
  pages come and go through code changes, not admin typing.
- What's **DB-stored** is only which ids are currently disabled — a
  comma-separated list under one `settings` key
  (`offlineMode.disabledTargets`), read/written via the existing generic
  `readSettings`/`writeSetting` helpers. **No new table, no migration.**
- New capability-only-ish **policy module**, same shape as `screensaver`
  (`server/src/modules/screensaver/module.ts`): server owns policy only,
  the actual warming stays 100% client.
  - `GET /api/offline-mode/config` — public, returns the registry (id +
    label) plus which ids are currently disabled. The client cross-references
    this against its own id→import-loader map (loaders can't be served over
    the wire, so the registry travels as data and the loaders stay
    code-only on the client).
  - `PATCH /api/offline-mode/settings` — admin-guarded (`app.requireAdmin`,
    same as screensaver's PATCH), toggles one id's disabled state.
  - `offlineMode.settingsUpdated` SSE broadcast on change, same live-rebind
    pattern as `screensaver.settingsUpdated`/`loki.settingsUpdated`/
    `theme.updated`.
- Registered in `MANIFEST` for **both profiles** — this is harmless client
  mechanism, not a LAN-trust concern, matching `toolbox`/`variant`/
  `screensaver`.
- No "keep at least one enabled" guard (unlike themes' `LAST_THEME` 409) —
  disabling everything just means the toggle warms nothing, not a broken
  state; this doesn't need the extra rule themes has.

### Trigger — manual, every time; the click itself is never persisted

A toggle switch, always starts Off on mount. Warm-load only ever runs from
the user's own click — never automatically, never re-armed from a
remembered preference (explicitly declined an "auto re-arm on load" design
during discussion). This is separate from the *registry* config above, which
correctly does persist server-side like any other admin setting — only the
toggle's on/off click-state is deliberately ephemeral.

**What a click does:** read the current enabled ids (from
`GET /api/offline-mode/config`, kept live via the SSE event), then fire the
corresponding subset of the six targets together in one
`Promise.allSettled`. Calling `import()` directly — independent of the
`lazy()` wrappers already in `App.tsx` — is safe and non-duplicating: ES
modules are singletons per resolved URL in a document's module graph, so
this resolves the same underlying module record `React.lazy` will later
read, with no double fetch.

**Status feedback**: a pill next to the toggle — *Off* → *Warming…*
(spinner, while the enabled targets are in flight) → *Ready offline* → or
*Partly ready* naming which target(s) failed, so a flaky fetch is never
silently reported as success.

**Where the state lives:** the warm-load status is state in `App.tsx`'s
persistent header shell (mounted once, wraps every route), *not* inside a
per-page component — the underlying warmed modules are a property of the
tab, not of whichever page rendered the toggle, so navigating between
Ollivanders and Diagon Alley after warming must not misleadingly reset the
pill to Off.

### Toggle visibility — page-scoped, not global

`App.tsx` already imports `useLocation`. The toggle renders conditionally in
the header, immediately before `<ThemeSwitcher />` (`App.tsx:218`), only
when `pathname === '/ollivanders'` or `pathname.startsWith('/diagon-alley')`
(covers `/diagon-alley/:toolId` too). Absent everywhere else — Midgard,
Hermes, Wardens, Heimdall, Pensieve, Accio, Nimbus, Portkey. Owner's explicit
instruction: not a global control.

### Storage and lifecycle — no persistence beyond the registry, by construction

Calling `import()` fetches each enabled chunk over the network once, then
registers it in the JS engine's **in-memory module registry** for that tab's
execution context — not localStorage, not the Cache API, not IndexedDB.
This satisfies the owner's "delete on tab close" requirement with **no
extra code**: the module registry is destroyed the instant the tab closes,
hard-reloads, or navigates cross-origin — nothing to evict, unlike a Service
Worker's Cache API storage, which would need an explicit "clear cache"
affordance. One honest caveat, not something to build against: the browser's
ordinary HTTP disk cache may still hold copies of those `.js` files
afterward, same as every asset on the site already gets from
`Cache-Control` headers — normal, not specific to this feature, and doesn't
help a closed/reopened tab anyway (a fresh navigation still needs the
network to revalidate).

### Standing-knowledge updates, so future plans remember this registry exists

- `.claude/skills/new-module/SKILL.md` — add a line near the "Client"
  section (step 7, route-level code splitting): when a new module ships a
  pure-client page/tool that works with no server round-trip once its code
  is loaded, consider adding it to the offline-mode registry
  (`client/src/app/offlineWarmLoad.ts` + the server registry in
  `server/src/modules/offline-mode/module.ts`) — see `docs/offline-mode.md`.
  This is the mechanical checkpoint, since the skill is already the required
  stop "whenever a plan or the owner introduces a new module."
- `architecture.md` — add `offline-mode` to the module registry table
  (profile: both) with a short paragraph in the same voice as the existing
  `screensaver`/`toolbox`/`variant` paragraphs, pointing to
  `docs/offline-mode.md` for mechanism detail rather than duplicating it.

### A technical reference doc ships alongside the code

`docs/offline-mode.md`, in the established `docs/` voice (`cloud-profile.md`,
`observability.md`: short framing paragraph, then terse H2 sections, tables
where useful, code blocks only where something is literally run/typed).
Technical content only — no owner-facing tutorial framing, no restating this
plan's narrative. Required section order (so nothing gets skipped):

1. Title + one-paragraph mental model — what it is, and in the same breath
   what it is not (no offline reload, no new-tab survival, no standalone
   file).
2. `## Why no Service Worker` — the secure-context restriction; cite the
   SHA-256 `supported()` gate (PLAN-18b) as the existing precedent.
3. `## Mechanism` — the six targets, `Promise.allSettled`, the ES-module-
   singleton reasoning for why calling `import()` outside `lazy()` doesn't
   double-fetch.
4. `## Registry and Heimdall policy` — code-owned registry vs. DB-stored
   disabled-ids overlay; the GET/PATCH/SSE trio; why granularity is
   page-level.
5. `## Where the code lives` — file → what it owns, covering every file in
   Touched files below.
6. `## Storage and lifecycle` — in-memory module registry only; why it dies
   free on tab close; the HTTP disk-cache caveat; contrast with the registry
   config, which correctly does persist server-side.
7. `## Deliberately out of scope` — Service Worker/offline-reload,
   standalone export file, Variant draft persistence, the toggle-click's
   no-persistence behavior — each a one-line "considered, not built,
   because…".

Cross-link it from `docs/ARCHITECTURE.md`'s pointer list, the same way every
other `docs/*.md` file is indexed there.

### Also flagged, not fixed here

`client/src/features/edda/EddaPage.tsx` was found during investigation to
contain 737 null bytes and read as binary data (`file` reports "data", not
text) as of `develop` HEAD (`fd382e3`, PLAN-20's merge). Unrelated to this
plan's scope; log it in `decisions.md` as a flagged issue, do not fix it in
this PR.

## Tasks

- [ ] `server/src/modules/offline-mode/module.ts`: registry constants,
      `GET /api/offline-mode/config`, admin-guarded
      `PATCH /api/offline-mode/settings`, `offlineMode.settingsUpdated`
      bus emit + SSE broadcast — modeled on
      `server/src/modules/screensaver/module.ts` and
      `server/src/modules/themes/services/db-theme-visibility-store.ts`
- [ ] `server/src/core/bus/events.ts`: add `offlineMode.settingsUpdated`
      event type
- [ ] `server/src/app.ts`: register `offlineModeModule` in `MANIFEST`, both
      profiles
- [ ] `client/src/core/offlineMode.ts`: registry id/label data (no feature
      imports), `fetchOfflineModeConfig()`, SSE subscription helper —
      modeled on `client/src/core/screensaver.ts`
- [ ] `client/src/app/offlineWarmLoad.ts`: the id → `() => import(...)`
      loader map (must live in `app/`, the composition-root tier — `core/`
      may not import from `features/` any more than features may import
      each other) + `runWarmLoad(enabledIds)` via `Promise.allSettled`
- [ ] `client/src/core/ui/OfflineModeToggle.tsx`: presentational switch +
      status pill, no feature imports — follows `ThemeSwitcher`'s precedent
- [ ] `client/src/app/App.tsx`: mount `OfflineModeToggle` conditionally
      (route-gated) at line ~218 before `<ThemeSwitcher />`, hold
      `warmStatus` state in the persistent shell so it survives navigation
      between the two gated pages
- [ ] `client/src/features/heimdall/api.ts`: `fetchOfflineModeConfig`/
      `setOfflineModeTargetEnabled` admin calls, alongside
      `fetchManagedThemes`/`setThemeEnabled`
- [ ] `client/src/features/heimdall/sections.tsx`: new `OfflineModeSection`
      (checkbox list bound to the registry, modeled on `ThemesSection`) +
      registration in the sections array
- [ ] `docs/offline-mode.md` — per the required structure above
- [ ] `docs/ARCHITECTURE.md` — add the pointer
- [ ] `.claude/skills/new-module/SKILL.md` — standing-knowledge update
- [ ] `.agent/context/architecture.md` — module registry row + paragraph
- [ ] Failure paths logged per `rules/coding.md` — the config fetch
      failing, a warm-load target failing, and the admin PATCH failing all
      get a line; a deliberately silent catch (e.g. an individual warm
      target's rejection, which `Promise.allSettled` already surfaces to
      the UI) gets a comment saying why silence there is correct
- [ ] Docs sync (`progress.md`, `decisions.md`, `plans/README.md`) +
      archive this file to `completed/` **in this PR**

## Acceptance criteria

1. Toggle renders only on `/ollivanders` and `/diagon-alley` (+ a tool
   open, `/diagon-alley/qr` etc.) — absent on `/`, `/hermes`, `/wardens`,
   `/accio`, `/nimbus`, `/portkey`, `/pensieve`, and inside Heimdall itself.
2. `GET /api/capabilities` includes `offline-mode`; a cloud-profile build
   still shows the toggle (registered in both profiles).
3. Clicking the toggle while online with all six enabled fires all six
   chunk requests once (seen in the network panel); the pill reaches
   *Ready offline*.
4. In Heimdall, disabling one target (e.g. Loki) via the new checkbox list
   broadcasts `offlineMode.settingsUpdated` over SSE to an already-open tab;
   clicking the toggle there fires only the remaining five, and the pill
   reflects five, not six. Re-enabling restores six.
5. With the browser throttled to offline, and without reloading, every
   enabled target opens via normal in-app navigation (toolbox cards,
   Ollivanders nav) with an instant mount, zero failed network requests for
   JS, and working local compute (format/lint/diff/transform).
6. Forcing one target's import to fail makes the pill report *Partly
   ready* naming the failed tool, never a false *Ready*.
7. Sanity check, pre-existing behavior not built by this plan: without
   clicking the toggle at all, a page already visited before going offline
   still works via the browser Back button.
8. Opening a **saved** Runestone/Groot/Edda by slug, and Pensieve, still
   correctly shows a connection error offline rather than crashing —
   regression-checked, not newly built.
9. Closing the tab and reopening a fresh one while still offline shows the
   ordinary browser "no internet" page — no false persistence promise.
10. No console errors or notification spam from SSE reconnect attempts
    while offline on the two gated pages.

## Tests

- [ ] Unit (server): `GET /api/offline-mode/config` returns the registry +
      disabled ids; `PATCH /api/offline-mode/settings` toggles one id,
      rejects an unknown id, requires admin (401/403 unauthenticated);
      `offlineMode.settingsUpdated` fires on toggle
- [ ] Unit (client): `core/offlineMode.ts`'s config fetch and SSE merge;
      `app/offlineWarmLoad.ts`'s `runWarmLoad` against a mocked loader map —
      confirms `Promise.allSettled` semantics (one rejected target doesn't
      fail the others, status reduces to Partly ready)
- [ ] Component: `OfflineModeToggle` renders the three status states;
      `OfflineModeSection` toggles a checkbox and calls the PATCH, shows an
      error on failure (mirrors `ThemesSection`'s test, if one exists)
- [ ] Boundaries lint passes — confirms `core/offlineMode.ts` truly holds
      no feature import (the mechanical proof that the `app/` vs. `core/`
      split in this plan is real, not just documented)
- [ ] Live-verify (`live-verify` skill): all ten acceptance criteria driven
      on the built server over CDP, including the offline throttle case and
      the Heimdall live-toggle-over-SSE case; restart smoke (the new module
      reads/writes the `settings` table, so worth a quick pass even though
      no migration is involved)
- [ ] Manual: a real phone on the LAN, toggling offline mode and confirming
      the warmed tools genuinely work with the device's Wi-Fi turned off

## On completion

This PR's paperwork: the docs sync in Tasks, plus **archiving this file to
`.agent/plans/completed/`** — a plan's own PR closes its own paperwork, per
the PLAN-18/PLAN-20 precedent.
