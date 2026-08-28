# Offline mode — warm-loading the pure-client pages

Offline mode is a switch in the header that, while the LAN is still reachable,
fetches the JavaScript for the pages that compute entirely in the browser —
Diagon Alley's toolbox and Ollivanders' four editors plus the diff view. Once
that code is in the tab, walking out of Wi-Fi range does not stop you opening
those pages: client-side routing mounts them from memory, with no request.

It is worth being precise about what that is **not**. It does not survive a
reload, a new tab, or a closed-and-reopened browser — the first thing any of
those does is ask the network for `index.html`. It is not a downloadable
standalone file. And it does nothing for anything that needs the server:
opening a saved document by slug, or the Pensieve, still fails offline exactly
as before. The unit of the promise is **the tab you already have open**.

## Why no Service Worker

A Service Worker is the standard way to survive a reload offline, and it is
unavailable here. Service Workers only register in a browser "secure context":
HTTPS, or the literal hostname `localhost`. Bifrost serves plain HTTP on the
LAN — a deliberate, logged choice (`tech-stack.md`: HTTPS/HTTP2 avoided since
it's LAN-only) — so a Service Worker would function only when the host Mac
opens `http://localhost:4646` in its own browser, and never from
`bifrost.local` or a LAN IP on a phone or laptop.

This is the same browser restriction that already hides the SHA-256 tool on
LAN devices: `crypto.subtle` is secure-context-only, which is why that tool
declares a `supported()` gate (PLAN-18b). A hard browser limitation, not an
engineering gap.

So offline mode builds only the part that works on every device: eagerly
resolving the module imports while the network is there.

## Mechanism

Six warmable targets, all page-level:

| id | What it warms |
|---|---|
| `toolbox` | `features/toolbox/ToolBody` — the one lazy chunk behind all thirteen Diagon Alley tools |
| `runestone` | `features/runestone/RunestonePage` |
| `groot` | `features/groot/GrootPage` |
| `edda` | `features/edda/EddaPage` |
| `variant` | `features/variant/VariantPage` |
| `loki` | `features/loki/LokiPage` |

A click reads the currently enabled subset and fires those loaders together
through `Promise.allSettled`. `allSettled`, not `all`: one chunk failing must
not cancel the rest, and the failures are needed **by name** so the status pill
can say *Partly ready — Loki (JS workbench) failed* rather than a false
*Ready offline*.

Calling `import()` here, beside the `lazy()` wrappers in `App.tsx`, does not
double-fetch. ES modules are singletons per resolved URL within a document's
module graph: the loader resolves the same module record `React.lazy` reads
when the route later mounts, so the second consumer gets the already-resolved
module and no request.

Warming is only ever triggered by a real click. The switch always mounts Off
and is never re-armed from a remembered preference. Switching it back off
resets the pill; it cannot un-import anything, because nothing can.

The status lives in `App.tsx`'s persistent shell rather than in a page. The
warmed modules belong to the tab, so navigating from Ollivanders to Diagon
Alley must not reset the pill to Off.

## Registry and Heimdall policy

The registry — which pages exist and what they are called — is **code-owned**,
because pages arrive through code changes, not admin typing. What an admin
controls is which of them are enabled, and that is **DB-stored**: one
comma-separated `settings` row under `offlineMode.disabledTargets`, the same
overlay shape `themes.disabled` uses. No new table, no migration.

| Route | Access | Purpose |
|---|---|---|
| `GET /api/offline-mode/config` | public | the whole registry (`{ id, label }`) plus the currently disabled ids |
| `PATCH /api/offline-mode/settings` | admin (`requireAdmin`) | `{ id, enabled }` — flips one target; a `404 UNKNOWN_TARGET` for an id the registry doesn't have |
| `offlineMode.settingsUpdated` | SSE | the full config, so an already-open tab warms the new set without a reload |

Loaders cannot travel over the wire, which is why the split exists at all: the
registry ships as **data** and the `id → () => import(...)` map stays code-only
on the client. The two lists are joined by id at runtime, so adding a page
means an entry in each.

Granularity is page-level on purpose. Diagon Alley's thirteen tools ship in one
chunk (PLAN-18), so a per-tool toggle would fetch exactly the same file — only
page-level entries are real toggles.

There is no "keep at least one enabled" guard, unlike themes' `LAST_THEME` 409.
Disabling everything means the switch warms nothing, which is a valid state,
not a broken one — the pill says *Nothing enabled*.

The module is registered in **both** deploy profiles. Warming client chunks is
harmless mechanism, not a LAN-trust concern, so it sits beside `toolbox`,
`variant` and `screensaver` in the manifest.

## Where the code lives

| File | What it owns |
|---|---|
| `server/src/modules/offline-mode/module.ts` | the registry constants, both routes, the `offlineMode.settingsUpdated` emit and its SSE fan-out |
| `server/src/core/bus/events.ts` | `OfflineModeTarget` / `OfflineModeConfig` and the event name |
| `server/src/app.ts` | `MANIFEST` entry, both profiles |
| `client/src/core/offlineMode.ts` | config types, the public GET and admin PATCH, `enabledTargets`/`targetLabel`, and the `WarmLoadStatus` shape |
| `client/src/app/offlineWarmLoad.ts` | the `id → () => import(...)` loader map and `runWarmLoad` |
| `client/src/core/ui/OfflineModeToggle.tsx` | the presentational switch and status pill |
| `client/src/app/App.tsx` | the route gate, the config fetch + SSE subscription, and the `warmStatus` state |
| `client/src/features/heimdall/sections.tsx` | `OfflineModeSection` — the admin checkbox list |
| `client/src/core/chunkError.ts` | recognises a failed dynamic import across every engine spelling, and bounds the wait |
| `client/src/core/ui/RouteBoundary.tsx` | the boundary that turns a missing chunk into a message instead of a crash |
| `client/src/app/lazyPages.tsx` | every route's `lazy` page, rebuildable so a retry is a real second attempt |
| `server/src/core/mdns/index.ts` | keeps a send failure from taking the process down, and rebuilds the responder when the LAN changes |

The loader map is in `app/` and not `core/` for a boundary reason, enforced by
`eslint-plugin-boundaries`: `core/` may not import from `features/` any more
than one feature may import another. Only the composition-root tier reaches
across every feature, so that is where the loaders live and where the
registry's data is joined to them.

The switch renders in the header immediately before the theme switcher, and
only on `/ollivanders`, `/diagon-alley` and `/diagon-alley/:toolId`. It is a
page-scoped control, not a global one.

## When a page is not warmed

Every page below the shell is `React.lazy`, so opening one this tab has not
loaded is a network request — and offline, or with the bridge down, that
request cannot be served. Before PLAN-22 the rejection reached the app-wide
`ErrorBoundary` and replaced the whole shell with "The bridge wavered",
offering a reload the browser could not perform. One wrong click cost the user
the tab, including the pages they *had* warmed.

`core/ui/RouteBoundary` sits between the shell and the routed pages and exists
for exactly that failure. It identifies a missing chunk by message — the
engines each word it differently and none give it a type or a code, so
`core/chunkError.ts` matches every spelling — and then:

- raises one notification and renders an inline panel in the page area,
  leaving the header, nav and every warmed page exactly where they were;
- logs a `warn` (not an `error`): an unreachable server is a condition, not a
  defect, and the line is what separates "the hub was down" from "the hub was
  up and the page was broken".

Anything that is *not* a missing chunk is re-thrown, so the app-wide boundary
still owns real bugs and their crash card. The failure clears on navigation, so
returning to a route later re-tries the import rather than showing a stale
panel. React re-renders synchronously after an error thrown during a concurrent
render, so the boundary de-duplicates by message — one unreachable chunk is one
log line and one toast.

The URL still changes. That is deliberate: the route stays linkable, and a
reload once the bridge is back opens the page normally.

### Bounding the wait

A refused connection fails instantly. A *vanished host* does not: the SYN goes
nowhere, nothing answers, and the browser waits out its own connect timeout —
measured at **45s and still counting** — during which the click looks like it
simply did nothing. That is the commonest failure here: a laptop that walked
out of Wi-Fi range with the tab open.

So every route loader is wrapped in `withChunkTimeout` (8s), as is each warm
target and the offline-mode config read. 8s is far above any real LAN chunk
load and far below the browser's patience, so a hung fetch becomes an answer
while a slow one still succeeds. Measured: **45s+ → 8.4s**, and 0.1s when the
device is properly offline and the browser fails fast on its own.

### Why recovery needs a reload

A module URL whose fetch fails is recorded as **failed in the document's module
map**, and every later `import()` of that same URL rejects from the map without
touching the network. Verified in Chromium: a second import after a blocked one
produces no request at all, while the same file under `?retry=1` — a different
map entry — loads fine. `React.lazy` caches its own rejection on top of that.

Two consequences, and the panel says which one applies:

- **Bridge still unreachable** → *Not available offline*, with **Try again**.
  The retry rebuilds the `lazy` payloads (`createLazyPages`), which recovers the
  case where our 8s timeout fired but the fetch landed a moment later — the map
  then holds a *fulfilled* entry and the retry resolves with no request. That is
  what a slow bridge looks like.
- **Bridge answering again** → *This page needs a reload*, with **Reload the
  page**. A genuine fetch failure is cached for the life of the document, so
  only a new document can load that chunk. Offering a retry here would be
  offering a button that provably cannot work.

Which of the two is showing is **measured, not inferred**: on a failure the
boundary asks `GET /api/health` directly (3s timeout) and, while the answer is
"down", keeps asking every 5s. The obvious signal — the SSE reconnecting — is
both indirect and slow: its backoff runs to 15s, and an EventSource keeps
reporting `open` for seconds after the network has gone, which had the panel
telling a freshly-offline user to reload — the one action that would cost them
the tab and every page they had warmed. When the probe flips to "up" the
boundary spends one free retry before settling on the reload wording.

The same module-map rule applies to warming: a target whose chunk hard-fails
cannot be warmed again in that tab, so the pill keeps reporting it as failed
until a reload.

## The server going down is a first-class case

"Offline" here means *the bridge is unreachable*, which is not the same as
`navigator.onLine === false`. Nothing in this feature reads that flag. The two
cases it has to survive are:

| Case | What the browser sees |
|---|---|
| The device leaves the LAN | `ERR_INTERNET_DISCONNECTED` |
| The device stays online, the server stops | `ERR_CONNECTION_REFUSED` |

`import()` rejects identically either way, the warmed modules are unaffected in
both, and the message names both possibilities rather than guessing.

Two server-side consequences belong here, because between them they are the
commonest way the second row happens. A hub that dies on a network blip — or
comes back unreachable by name — cannot honour any offline promise.

**It used to exit.** bonjour-service's default error callback is `throw err`,
invoked from a dgram *send* callback, so `EADDRNOTAVAIL 224.0.0.251:5353`
arrived as an `uncaughtException` and the fatal handler took the process with
it. Losing the advertisement costs `bifrost.local`; every LAN IP still serves —
so it is a `warn` now.

**It used to come back deaf.** `multicast-dns` re-joins multicast groups on a 5s
interval, but its `update()` loop skips any address already in its `memberships`
map — a map only ever cleared on `destroy()` — while the OS silently drops the
membership when the interface goes down. So an interface that leaves and returns
on the *same* address is never re-joined: the socket is joined in bookkeeping
and deaf in fact, and the responder answers nothing until the process restarts.
A new DHCP lease recovers by itself; an unchanged address never does, which is
exactly why returning to the same network looked like it "takes forever".

`watchNetworkChanges` polls `lanIPv4Addresses()` every 5s and rebuilds the
responder whenever the set changes. That fixes both directions and re-announces
the service, so other devices' caches refresh instead of ageing out. It is
silent on a stable network — measured over 10 minutes of polling, zero
rebuilds.

## Storage and lifecycle

`import()` fetches each chunk over the network once, then registers the module
in the JS engine's **in-memory module registry** for that tab's execution
context. Not localStorage, not the Cache API, not IndexedDB.

That is the whole lifecycle story, and it needs no code: the module registry
dies with the tab. Closing it, hard-reloading, or navigating cross-origin
discards everything, so there is nothing to evict and no "clear cache" button
to build — which a Service Worker's Cache API would have required.

One honest caveat: the browser's ordinary HTTP disk cache may still hold copies
of those `.js` files afterwards, exactly as it does for every asset on the site
under its normal `Cache-Control` headers. That is not specific to this feature,
and it does not help a closed-and-reopened tab anyway — a fresh navigation
still needs the network for the document itself.

The registry **policy** is the one thing that does persist, and correctly so:
it is an admin setting in the `settings` table, and it survives restarts like
any other.

## Deliberately out of scope

- **Service Worker / offline reload** — considered, not built: secure-context
  only, so it would work on the host Mac and no other device (see above).
- **A standalone downloadable HTML export** — considered, not built: it solves
  a different problem ("a copy I can keep") than "the tab I already have open".
- **Variant draft persistence** — Variant has no draft storage of its own, so
  typed content is lost on any remount, online or offline. A pre-existing gap,
  flagged and explicitly left alone by this work.
- **Persisting the switch's own on/off state** — considered, not built:
  warming is a network action, and an auto re-arm on every page load would run
  it without anyone asking. The registry persists; the click does not.
- **Loading saved documents by slug, and the Pensieve** — these genuinely need
  the server. Offline they fail; what this feature owns is that they fail
  *legibly* (see "When a page is not warmed"), not that they succeed.
- **Blocking the click instead of the navigation** — considered, not built:
  intercepting every link into a cold route means a route→chunk map and an
  app-wide click handler that programmatic navigation, Back/Forward and typed
  URLs would all walk straight past. The boundary catches every path in.
