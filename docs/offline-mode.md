# Offline mode

A switch in the header, on Ollivanders and Diagon Alley, that fetches the code
for Bifrost's pure-client pages while the bridge is still reachable. Once that
code is in the tab, those pages keep opening after the bridge is gone — the
device left the LAN, or the server stopped.

The unit of the promise is **the tab you already have open**. Nothing here
survives a reload, a new tab, or a closed browser: the first thing any of those
does is ask the network for `index.html`. Pages that need the server — a saved
document by slug, the Pensieve — still need it.

## Why not a Service Worker

A Service Worker is the standard way to survive a reload offline, and it only
registers in a browser "secure context": HTTPS, or the literal hostname
`localhost`. Bifrost serves plain HTTP on the LAN, so one would work on the host
Mac's own browser and on no other device. Same restriction that hides the
SHA-256 tool everywhere but `localhost` (PLAN-18b).

So offline mode builds only the part that works on every device: resolving the
module imports early.

## The flow

1. On load, the app reads `GET /api/offline-mode/config` — the list of warmable
   pages and which of them an admin has disabled in Heimdall. It re-reads on the
   `offlineMode.settingsUpdated` SSE event, so an open tab sees a change without
   a reload.
2. The user flips the switch. It always starts **Off** and is never re-armed
   from a remembered preference — warming is a network action and only ever runs
   from a click.
3. `runWarmLoad` fires the enabled subset together through `Promise.allSettled`.
   One chunk failing must not cancel the rest, and the failures are needed by
   name, so the pill can say *Partly ready — Loki (JS workbench) failed* rather
   than a false *Ready offline*.
4. The pill settles: *Ready offline · N*, *Partly ready — …*, *Bridge
   unreachable* (nothing arrived at all), or *Nothing enabled*.
5. The bridge goes away. Client-side routing mounts the warmed pages from
   memory, with no request.

Status lives in `App.tsx`'s persistent shell, not in a page: the warmed modules
belong to the tab, so navigating between the two gated pages must not reset the
pill.

## What gets warmed

| id | Chunk |
|---|---|
| `toolbox` | `features/toolbox/ToolBody` — the one chunk behind all thirteen Diagon Alley tools |
| `runestone` | `features/runestone/RunestonePage` |
| `groot` | `features/groot/GrootPage` |
| `edda` | `features/edda/EddaPage` |
| `variant` | `features/variant/VariantPage` |
| `loki` | `features/loki/LokiPage` |

Granularity is page-level because Diagon Alley's thirteen tools ship in one
chunk — a per-tool toggle would fetch the same file.

The registry is code-owned and lives on the server; only the *disabled* ids are
stored (one comma-separated `settings` row). It has to travel as data because a
loader cannot be serialised, so the ids are joined to the actual
`() => import(...)` map on the client, in `app/offlineWarmLoad.ts`. Adding a
page means an entry in each.

That file is in `app/` and not `core/`: it imports across every feature, and
only the composition-root tier may. `eslint-plugin-boundaries` enforces it.

Calling `import()` here, beside the `lazy()` wrappers, does not double-fetch. ES
modules are singletons per resolved URL in a document's module graph, so the
loader resolves the same module record `React.lazy` reads when the route mounts.

## Bounding the wait

A refused connection fails instantly. A *vanished host* does not: the SYN goes
nowhere, nothing answers, and the browser waits out its own connect timeout —
measured at 45s and still counting, during which a click looks like it did
nothing at all. That is the commonest failure here, a laptop that walked out of
Wi-Fi range with the tab open.

So every route loader and every warm target is wrapped in `withChunkTimeout`
(8s) — far above any real LAN chunk load, far below the browser's patience. It
bounds the *waiting*, not the fetch. The config read carries the same 8s bound
through `apiGet`'s opt-in `timeoutMs`, since the switch stays disabled until it
answers.

## When a page was not warmed

Every page below the shell is `React.lazy`, so opening one this tab has not
loaded is a network request. `core/ui/RouteBoundary` catches that failure,
raises one notification and renders an inline panel in the page area — the
header, nav and every warmed page stay exactly where they were. A missing chunk
is identified by message (`core/chunkError.ts`), since no engine gives the
rejection a type or a code. Anything that is *not* a missing chunk is re-thrown,
so the app-wide `ErrorBoundary` still owns real bugs.

The way out depends on whether the server is answering, and the panel says
which:

- **Unreachable** → *Not available offline*, with **Try again**. The retry
  rebuilds the `lazy` payloads (`app/lazyPages.tsx`), which recovers the case
  where the 8s timeout fired but the fetch landed a moment later — the module
  map then holds a *fulfilled* entry and the retry resolves with no request.
- **Answering again** → *This page needs a reload*, with **Reload the page**.

That second case is a browser rule, not a choice: a module URL whose fetch fails
is recorded as **failed in the document's module map**, and every later
`import()` of that URL rejects from the map without touching the network.
Verified in Chromium — a second import after a blocked one makes no request,
while the same file under `?retry=1` loads fine. Vite owns the chunk URLs, so
only a new document can undo it. The same rule applies to warming: a target
whose chunk hard-fails cannot be warmed again in that tab.

Which case applies is **measured, not inferred**. On a failure the boundary
probes `GET /api/health` (3s), and keeps asking every 5s while the answer is
"down", spending one free retry when it flips to up. The obvious signal — the
SSE reconnecting — is both slow (backoff to 15s) and wrong: an EventSource keeps
reporting `open` for seconds after the network has gone, which had the panel
telling a freshly-offline user to reload, the one action that would cost them
the tab and every page they had warmed.

Nothing here reads `navigator.onLine`. "Offline" means the bridge is
unreachable, which covers both the device leaving the LAN
(`ERR_INTERNET_DISCONNECTED`) and the server stopping while the device stays
online (`ERR_CONNECTION_REFUSED`). `import()` rejects identically either way.

## Lifecycle

`import()` fetches each chunk once, then registers the module in the JS engine's
in-memory module registry for that tab. Not localStorage, not the Cache API, not
IndexedDB — so there is nothing to evict and no "clear cache" affordance to
build. It dies with the tab.

The browser's ordinary HTTP cache may still hold those `.js` files afterwards,
as it does for every asset on the site. That is not specific to this feature and
does not help a reopened tab, which needs the network for the document itself.

The registry *policy* is the one thing that persists, correctly: it is an admin
setting in the `settings` table and survives restarts.

## Where the code lives

| File | What it owns |
|---|---|
| `server/src/modules/offline-mode/module.ts` | the registry, both routes, the `offlineMode.settingsUpdated` emit and its SSE fan-out |
| `client/src/core/offlineMode.ts` | config types, the public GET and admin PATCH, and the warm-load status shape |
| `client/src/app/offlineWarmLoad.ts` | the `id → () => import(...)` map and `runWarmLoad` |
| `client/src/core/ui/OfflineModeToggle.tsx` | the switch and its status pill |
| `client/src/app/App.tsx` | the route gate, the config fetch and SSE subscription, and the warm status |
| `client/src/app/lazyPages.tsx` | every route's `lazy` page, rebuildable so a retry is a real second attempt |
| `client/src/core/chunkError.ts` | recognises a failed dynamic import, and bounds the wait |
| `client/src/core/ui/RouteBoundary.tsx` | turns a missing chunk into a message instead of a crash |
| `client/src/features/heimdall/sections.tsx` | the admin checkbox list |
