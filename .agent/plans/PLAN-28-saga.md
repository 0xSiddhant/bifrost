# PLAN-28 — Saga

## Goal

A fullscreen slideshow viewer — "Saga" — for a saved Edda document or a dropped `.md` file: `---`-delimited slides, keyboard/touch navigation, fullscreen, presenter notes. It ships as a fourth consumer of the same `renderMarkdown` pipeline Edda's live preview, public page, HTML/PDF export, and file-preview modal already share, and adds no new server surface beyond a capability-only module. A `bifrost saga <file>` CLI command opens a local `.md` file the same way, from a terminal. Promotes the **Skald** row from `PLAN-99-future-backlog.md`'s "Owner-reviewed additions," renamed after a same-session naming discussion. PDF support is deliberately a separate plan (PLAN-29) — see Scope.

## Gate

PLAN-27 merged. Single PR. (Saga's CLI command extends `cli/`'s existing `core/browser.ts` and command-registration shape; nothing here works without that already existing.)

## Verified against the codebase, not assumed

- `client/src/app/pages/MidgardPage.tsx`: `PORTALS` is a flat, data-driven array (`{ to, icon, title, description, go, module? }`), each rendered as a `<Portal tone={index+1} {...portal} />` — colour is positional, not per-identity (matching the card-tone rule everywhere else). `module` is optional and, per its own doc comment, "omitted = always shown" — Accio's entry is the one example that sets it (`module: 'accio'`); this is the exact mechanism a `saga` capability-gated card needs, confirmed by reading the live file rather than assumed from the pattern's name.
- `client/src/app/App.tsx`: the `NAV` array's Midgard entry (`{ to: '/', label: 'Midgard', ... modules: [null] }`) carries no `match` array today — Ollivanders' and Diagon Alley's entries do (`match: ['/runestone', ...]`), which is what keeps their tab lit on a sub-route. Midgard needs one added for `/saga` to light the right tab. Also confirmed: `/edda` and `/edda/:slug` both already route to the same `<pages.EddaPage />` — one component legitimately handles both the bare and the slugged form of a route, which is the direct precedent for `SagaPage` doing the same for `/saga` and `/saga/:slug`.
- `server/src/modules/toolbox/module.ts`: the real shape of a **capability-only** module — `register()` is a deliberate no-op, and "being in the manifest is what puts the tools in `/api/capabilities`." `variant` uses the same shape. This is the exact model for a new `saga` module: no routes, no tables, no events, registered in both profiles.
- `client/src/core/edda.ts`: `fetchEdda(slug)` already exists, already follows the API's 301 stale-slug redirect transparently, and already returns `null` on a 404 rather than throwing. Saga presenting a saved document calls this directly — a `core/` import, not a `features/edda` import, so it is not a cross-feature-import violation.
- `client/src/core/markdown/index.ts`: the barrel already exports `renderMarkdown`, `useMermaidDiagrams`, `renderMermaidIn`, `outline`, `stats`, `runCommand` — Saga takes only `renderMarkdown` and `useMermaidDiagrams`; `outline`/`stats`/`runCommand` are editor-specific and unneeded here.
- `client/src/app/pages/PensievePage.tsx` (lines ~341–384): each row action is a plain conditional — `entry.readRoute && <Link>…</Link>`, `entry.apiRoute && entry.mimeType && <button onClick={copyCurl}>`, `entry.apiRoute && <a>…</a>` — read directly to model a new `entry.presentRoute && <Link>` the same way, in the same conditional-rendering style, not a new pattern.
- `client/src/core/ui/icons.tsx`: scanned the full export list (40+ icons) — there is no slides/presentation icon today. A new `SlidesIcon` is a real addition, not an oversight.
- `client/src/features/previews/PreviewModal.tsx`: the real keyboard-capture pattern already in use — `window.addEventListener('keydown', onKey)` inside a `useEffect`, removed on cleanup. Saga's navigation hook uses the same shape rather than inventing a second one.
- `client/src/app/offlineWarmLoad.ts` and `server/src/modules/offline-mode/module.ts`'s `TARGETS`: confirmed as two hand-kept-in-step lists (client loader map + server id/label registry) covering today's seven pure-client pages (`toolbox`, `runestone`, `groot`, `atlas`, `edda`, `variant`, `loki`). Saga's core render path has the same "works with zero network" property as those seven (the drag-drop path is 100% local; the saved-Edda path needs one GET, same as Edda's own editor already does when offline-warmed) — an eighth entry, not a new registry.
- `URL.createObjectURL`/`revokeObjectURL` and `fetch`'s `ReadableStream`/CORS handling are universally supported browser APIs (unlike the File System Access API, which is Chromium-only and was considered and rejected during this feature's design discussion) — no spike is warranted for either; both are used exactly as documented, with no platform-specific behavior this plan depends on.

## Scope

**In:**
- `---`-on-its-own-line slide breaks, refined so a `---` as the document's very first line does **not** split (avoids colliding with any front-matter-shaped opening) — a deckrun-inspired refinement over the original backlog note's plain "`---` breaks."
- Keyboard nav (→/↓/Space/PageDown next, ←/↑/Backspace/PageUp previous, Home/End first/last — deckrun's own bindings) **plus** W/A/S/D as parallel bindings (W/A previous, S/D next) — a Bifrost addition deckrun itself doesn't have.
- Touch swipe navigation (50px threshold, deckrun's own number).
- Two real modes: **windowed**, with a static, always-visible footer (slide position, a key-hint string, prev/next buttons, a fullscreen button, a notes toggle when the current slide has one), and **fullscreen** (`requestFullscreen`/`exitFullscreen` on Saga's own container), where the same footer auto-hides on inactivity and reappears on mouse movement, a keypress, or a tap.
- A `?`/`H` shortcuts overlay listing every binding above.
- Presenter notes via `<!-- notes: ... -->` HTML comments, shown in a toggleable panel; absent entirely when a slide has none.
- Two sources: a saved Edda by slug (`/saga/:slug`, via the existing public `/edda/api/:slug`) and a dropped `.md`/`.markdown` file (`/saga`, via `URL.createObjectURL` — no upload, no browser storage).
- One CLI command, `bifrost saga <file>`, opening a local `.md`/`.markdown` file the same way from a terminal.
- A "Present" row action on Pensieve's Edda rows, next to "Read."
- A `saga` capability-only server module (manifest presence + profile gating only, matching `toolbox`/`variant`) and a Midgard nav card.

**Out:**
- **Incremental reveals (`{reveal}`)** — deckrun's most distinctive idea, explicitly discussed and rejected: it needs new per-slide state and changes what "next" means dynamically, which nothing in this codebase's current standard already does. Not a "maybe later" either — cut on the merits, not deferred for lack of time.
- **PDF as a slide source** — a separate plan, PLAN-29. It isn't from deckrun (deckrun is markdown-only) and reuses nothing this codebase already has (no existing PDF/canvas-rendering pipeline), unlike everything else in this list.
- Deckrun's composition templates and 5 transitions. Saga inherits whichever Bifrost theme is already active (same as Edda's live preview, public page, and PDF export already do) rather than adding a second, competing template system; slide transitions ship as one simple default, not a picker.
- Deckrun's presenter power-tools (laser pointer, drawing pen, blackout, overview grid) and deck linting. Real product surface for a standalone presentation tool; over-scoped for a view mode over an already-saved document.
- Editing inside Saga. It is a viewer; changing content still means going back to Edda (or, for a dropped file, editing it locally and dropping it again).
- Presenting Runestone/Groot/Atlas documents. Saga presents markdown-shaped content; a JSON/YAML/XML document has no `---`-slide structure to render, and the CLI's own `preview` command (PLAN-27) already covers "open the best available view of any document kind" for the raw-data case.
- Persisting a dropped file anywhere — no `sessionStorage`, no `IndexedDB`, no server upload. Losing an in-progress dropped deck on an accidental refresh is accepted, matching how Loki's execution state and Diagon Alley's tools already behave; the drop is re-done, not recovered.

## Decisions & reasoning

### Midgard, not Ollivanders — and its own dedicated route, not a Diagon Alley inline card

Diagon Alley's cards (PLAN-18) expand in place, inline, pure-client — that shape does not fit a fullscreen, keyboard-capturing slideshow at all, so Ollivanders-or-Midgard was the real choice. Ollivanders is the dev-tool suite (Runestone/Variant/Edda/Loki/Groot/Atlas); Midgard is the everyday, non-technical LAN loop (Send/Receive/Hermes, plus Accio). "Drop a file, present it on the shared screen" reads far closer to Send/Receive's audience than to Loki's. Moving the card between hubs is purely a `MidgardPage.tsx`/`NAV` change — the route (`/saga`) and feature folder (`features/saga/`) are identical either way.

### One URL-based loader unifies all three sources — no browser storage, no per-source special-casing

The feature's real job, reduced to one function: given a URL, `fetch()` it and hand the text to the slide parser. Each source is just a different way of producing that URL:
- Saved Edda → the existing `/edda/api/:slug` (via `core/edda.ts`'s `fetchEdda`, not a raw manual fetch, so the 301-follow and 404-handling it already has are reused rather than re-derived).
- A dropped file → `URL.createObjectURL(file)`, revoked (`revokeObjectURL`) on unmount or the next drop. The `File` object from a drop event is already sitting in browser memory; this gives it a `fetch()`-able address without copying its bytes anywhere else. Universally supported (unlike the Chromium-only File System Access API, considered and rejected during design discussion for exactly that gap).
- The CLI → `http://127.0.0.1:<ephemeral-port>/payload`, served by a tiny local HTTP server the CLI itself hosts (see the CLI decision below). A browser page cannot read an arbitrary local path with no user gesture — that's a hard security boundary, not a limitation to design around — so the CLI has to serve the bytes over a real (if local) HTTP request; once it does, it is just a third URL to the same loader.

`loadSource.ts` is therefore the only place any of this logic lives; `SagaPage` doesn't know or care which of the three produced its URL.

### Two real modes — windowed with a persistent footer, fullscreen with the same footer auto-hiding — not one screen with a bolted-on toggle

`requestFullscreen()` is called on Saga's own slideshow container, **not** `document.documentElement` — so the browser's own Fullscreen API does the work of hiding Bifrost's app header/nav the moment fullscreen is entered, for free, and CSS's `:fullscreen` pseudo-class (scoped to that same container) is what actually distinguishes the two modes' styling. One `SlideFooter` component renders in both; there is no second, fullscreen-only chrome tree to keep in sync with the first.

**Windowed mode** — the default, whether arriving via a saved Edda's slug, a drop, or the CLI: a static footer bar beneath the slide that never hides — position (`3 / 12`), a compact hint string (`← → navigate · F fullscreen · ? shortcuts`), explicit prev/next buttons, a fullscreen button, and a notes toggle (only when the current slide has one). Bifrost's own app header stays visible above it: this is still a page inside the app, not the presentation itself, and a person should be able to click away without an escape-fullscreen step first. Explicit click targets for navigation matter here specifically because not everyone will discover the keyboard bindings, and a touch user without a keyboard has no other way in.

**Fullscreen mode** — the identical footer, but it auto-hides after roughly three seconds of no mouse movement, keypress, or touch, and reappears instantly on any of those: the same interaction model a native `<video>` element's own controls already use, so nobody presenting or watching has to learn a new convention. A tap toggles it directly on a touch device, where there's no hover/mouse-move signal to key off at all. It overlays the slide on a subtle gradient scrim rather than reserving fixed layout space — reserving space would make the slide visibly shift every time the footer faded in or out, which reads as unpolished in the middle of an actual presentation. The show/hide transition is an instant cut, not a fade, under `prefers-reduced-motion` — this codebase's existing convention (screensaver, Mermaid) applied here rather than skipped because the feature is new.

No existing Bifrost feature auto-hides its own chrome on inactivity — a real, new piece of interaction logic (`useIdleActivity.ts`, listening for `mousemove`/`keydown`/`touchstart` and exposing a simple active/idle boolean with the timeout), not a reused pattern, called out as such rather than implied as a copy of something already proven in this codebase. The one thing already proven here is the *shape*: a native `<video controls>` element already auto-hides the same way, just as browser-built-in behavior rather than Bifrost's own code — the footer's interaction model matches what every viewer already unconsciously expects from exactly that experience.

### `?source=<url>` on the bare `/saga` route, not a separate path

The CLI needs *some* address to open the browser to; reusing the same route the drag-drop landing page already lives on, with one query param, avoids inventing a fourth route for what is really the same "load this URL" case the loader already handles. Accepting an arbitrary caller-supplied URL here is a real, if minor, consideration — a crafted `/saga?source=http://evil.example/x` link would make the visitor's own browser `fetch()` and render that content as slides. Worth naming rather than skipping past: `renderMarkdown` already runs everything through DOMPurify (confirmed, Edda's own pipeline), so the worst case is misleading rendered text within the trusted origin, not script execution — the same class of already-accepted risk Portkey's own arbitrary-http(s)-target design carries. No new guard is added for it here; DOMPurify's existing sanitization is the boundary, the same as it already is for every other `renderMarkdown` consumer.

### CLI: a local, single-request HTTP server — no new persistent storage, anywhere

`bifrost saga <file>` starts a Node `http` server (built-in, no new dependency — same "well-established, no spike needed" reasoning PLAN-27 already used for `pull`'s streaming), bound to an OS-assigned free port, streaming the file straight off disk (`fs.createReadStream`, no buffering — this is the "read it from the file system directly" instinct from the design discussion, done by the one side of this boundary actually allowed to). It sets `Content-Type: text/markdown` and, deliberately tighter than the raw document endpoints' `Access-Control-Allow-Origin: *`, the **specific** Bifrost origin `discover.ts` already resolved before the browser was even opened — the one caller is known, so there's no reason to allow any origin. It serves exactly one successful request, then closes itself; a 60-second timeout closes it (and reports a clear message) if the browser tab never actually requests it — closing over a real failure mode (the tab didn't open, or was closed first) rather than hanging forever. The browser is opened via the CLI's existing `core/browser.ts` (`preview`/`go --open`'s own launcher), not a second mechanism.

Extension validation happens **before** the server ever starts: `.md`/`.markdown` only in this plan. A `.pdf` (or anything else) is rejected with a clear message — PDF support is PLAN-29's job, and by the time it lands this same command and server gain one more accepted extension and `Content-Type`, nothing else about the mechanism changes.

### Presenter notes: a toggleable panel, not a second markdown pipeline

`<!-- notes: ... -->` is already an inert HTML comment to CommonMark — `renderMarkdown` already drops it from visible output with zero new parsing rule needed there. `parseSlides.ts` extracts it per-slide (a small, targeted regex pass over the raw text, the same kind of raw-text pass Edda's own `outline.ts`/`stats.ts` already run over a document before anything is rendered) and a simple show/hide panel renders it — the same "an optional side panel next to the main content" shape this codebase already reaches for elsewhere (Loki's output drawer, Edda's outline panel), not a shared component being reused, just a familiar, already-proven UI shape. A slide with no note renders no panel content at all — never an empty box.

### Slide-break parsing: `---` not on the first line, and the code-fence caveat is accepted, not fixed

A `---` inside a fenced code block still splits the document — deckrun has the identical, documented caveat, and fixing it means a fence-aware scanner (tracking open/close state across the whole document) for a case that is rare in practice and not worth the parser complexity for a v1 viewer. Pinned by a test that documents the behavior as-is, not as a bug to chase.

### No spike needed for `requestFullscreen`/`URL.createObjectURL` — considered, not assumed away

Both are long-standing, universally supported browser APIs with no platform-specific behavior this plan leans on (unlike PLAN-27's genuine `.local`-resolution and `fetch`-streaming questions) — stated here explicitly so the absence of a spike reads as a checked box, not an oversight.

## API contracts

None. The new `saga` server module (capability-only, matching `toolbox`/`variant`) registers no routes. Saga's web page reads one already-existing, unchanged endpoint (`GET /edda/api/:slug`) and otherwise runs entirely client-side. The CLI's `bifrost saga <file>` command talks to a tiny server **it hosts itself** on the operator's own machine — not to the Bifrost server at all — for the file-serving half of its job; it still uses the Bifrost server's origin only to know where to open the browser.

## Task checklist

**Server**
- [ ] `server/src/modules/saga/module.ts`: capability-only module (no-op `register()`), registered in both profiles — mirrors `toolboxModule` exactly

**Core (`client/src/core/`)**
- [ ] `core/library/types.ts` + `registry.tsx`: new optional `presentRoute?(item): string` on `LibraryEntry`; set only on `eddaEntry`, → `/saga/${item.slug}`
- [ ] `core/ui/icons.tsx`: new `SlidesIcon`

**Feature (`client/src/features/saga/`)**
- [ ] `parseSlides.ts`: split on a `---` line that isn't the document's first line; extract a `<!-- notes: ... -->` comment per slide (stripped from the rendered body); unit-tested including the accepted code-fence caveat
- [ ] `loadSource.ts`: fetch a URL, hand the text to `parseSlides`
- [ ] `SlideView.tsx`: renders one slide via `renderMarkdown` + `useMermaidDiagrams`
- [ ] `useSlideshowNav.ts`: current-index state; `window.addEventListener('keydown', ...)` in a `useEffect` with cleanup (arrows/space/home/end/WASD); touch swipe (50px threshold)
- [ ] `useIdleActivity.ts`: `mousemove`/`keydown`/`touchstart` listeners → active/idle boolean on a ~3s timeout; used only in fullscreen mode
- [ ] `SlideFooter.tsx`: position indicator, hint string, prev/next buttons, fullscreen toggle, notes toggle (when applicable) — static in windowed mode, overlaid on a scrim and driven by `useIdleActivity` in fullscreen; tap-to-toggle on touch; instant show/hide under `prefers-reduced-motion`
- [ ] `NotesPanel.tsx`: toggleable, renders nothing when the current slide has no note
- [ ] `ShortcutsOverlay.tsx`: `?`/`H`-triggered modal
- [ ] `Dropzone.tsx`: drag target for the bare `/saga` landing state; `.md`/`.markdown` only, `URL.createObjectURL` + `revokeObjectURL` on unmount/next drop
- [ ] `SagaPage.tsx`: composes the above; no slug/`source` → `Dropzone`; a slug or `?source=` present → the slideshow shell (slide + `SlideFooter`), `requestFullscreen()` called on this component's own container element, never `document.documentElement`
- [ ] `saga.css`

**Wiring**
- [ ] `App.tsx`: routes `/saga` and `/saga/:slug` → `pages.SagaPage`; Midgard's `NAV` entry gains `match: ['/saga']`
- [ ] `MidgardPage.tsx`: new `PORTALS` entry (`module: 'saga'`, positional tone)
- [ ] `PensievePage.tsx`: a "Present" row action (`entry.presentRoute && <Link>`) next to "Read," Edda rows only
- [ ] `client/src/app/offlineWarmLoad.ts` + `server/src/modules/offline-mode/module.ts`'s `TARGETS`: add `saga`

**CLI (`cli/src/`)**
- [ ] `core/localServe.ts`: `serveFileOnce(filePath)` — Node's built-in `http`, `fs.createReadStream`, `.md`/`.markdown` only (validated by the caller before this is invoked), `Content-Type: text/markdown`, `Access-Control-Allow-Origin` set to the resolved Bifrost origin (not `*`), closes after one successful request or a 60s timeout
- [ ] `core/localServe.test.ts`: real ephemeral server, real local `fetch()` against it — no Bifrost server, no mocking
- [ ] `commands/saga.ts`: `bifrost saga <file>` — validates the extension before starting anything, starts `localServe`, opens `${origin}/saga?source=http://127.0.0.1:<port>/payload` via the existing `core/browser.ts`, reports success or the timeout

**Docs**
- [ ] `architecture.md`: a short paragraph on Saga (pure client, `presentRoute` registry extension, the CLI local-serve mechanism)
- [ ] Root `README.md`: a Features bullet for Saga, matching every other tool's; `cli/README.md` (PLAN-27) gains a `saga` command entry once that file exists
- [ ] `decisions.md` / `progress.md`
- [ ] `context-sync` pass once implemented; archive this plan file into `completed/` in the implementation PR

## Acceptance criteria

1. Landing on `/saga` with no slug and no `source` shows the dropzone; dropping a real `.md` file renders it as slides immediately, with zero network requests for the render itself.
2. Clicking "Present" on a real saved Edda's row in Pensieve opens `/saga/<slug>` and renders that document's actual saved content as slides.
3. A `---` on its own line splits slides; the same three characters as the document's literal first line do not, verified against a real document that opens with one.
4. →/↓/Space/PageDown, ←/↑/Backspace/PageUp, Home/End, and W/A/S/D all navigate correctly; a 50px+ touch swipe navigates on a mobile viewport.
5. In windowed mode, the footer (position, hint string, prev/next buttons, fullscreen button, notes toggle when applicable) is visible at all times and never hides on its own; Bifrost's own app header remains visible above it.
6. Fullscreen toggles via a real `requestFullscreen()`/`exitFullscreen()` call on Saga's own container — verified by checking `document.fullscreenElement` is that container, not `document.documentElement` — and Bifrost's app header disappears as a direct result of the browser's own Fullscreen API, not any Saga-specific hiding logic.
7. In fullscreen, the footer auto-hides after ~3 seconds of no mouse movement, keypress, or touch, and reappears instantly on any of those; a tap toggles it directly on a touch viewport; under `prefers-reduced-motion` the show/hide is an instant cut, not a fade.
8. The footer overlays fullscreen slide content on a scrim rather than occupying layout space — the slide's own position and size do not change when the footer appears or disappears, verified by measuring the slide's bounding box in both states.
9. `?` or `H` opens the shortcuts overlay, listing every binding in (4), in both windowed and fullscreen mode.
10. A slide with a `<!-- notes: ... -->` comment shows that text in the notes panel and nowhere in the rendered slide body; a slide without one shows no panel content and no notes-toggle button in the footer.
11. `bifrost saga <file>` for a real local `.md` file opens the system's default browser to a real, running presentation of that exact file's content — verified end to end, not just that a local server started — and the CLI's server closes itself once that one request completes.
12. A `.pdf` or any other non-markdown extension passed to `bifrost saga` is rejected with a clear message before any server starts.
13. The Saga card is present on Midgard and the Pensieve "Present" link is present on Edda rows only when `/api/capabilities` reports the respective module — verified by toggling each off and confirming both disappear, not just assumed from the gating code.
14. No file under `server/` beyond the new `saga` module, and no file under `client/src/core/library`, `client/src/core/markdown`, `client/src/core/edda.ts`, or `cli/src/core/browser.ts`, changes in a way that alters any *other* consumer's behavior — confirmed by the diff, not assumed from the design.

## Test checklist

- [ ] Unit `parseSlides.test.ts` — break-not-on-first-line, the accepted code-fence caveat (pinned, not "fixed"), notes-comment extraction and stripping
- [ ] Unit `loadSource.test.ts` — a mocked `fetch`, text handed to `parseSlides` unchanged
- [ ] Component `SagaPage`/`Dropzone` — drop → render flow (a real `File`, real `URL.createObjectURL`, no mock), keyboard nav via simulated key events, shortcuts overlay open/close, notes panel show/hide
- [ ] Unit `useIdleActivity.test.ts` — fake timers: active immediately, idle after the timeout with no events, resets on a simulated `mousemove`/`keydown`/`touchstart`
- [ ] Component `SlideFooter` — always visible and static in windowed mode; in a fullscreen-flagged render, hides after the idle timeout and reappears on a simulated activity event or a tap; slide bounding box unchanged across both footer states
- [ ] Unit (CLI) `core/localServe.test.ts` — correct bytes, `Content-Type`, and CORS header served on a real ephemeral port; closes after one request; closes on timeout when never fetched
- [ ] Live-verify: a real saved Edda presented via Pensieve's "Present" link; a real dropped `.md` file; `bifrost saga <file>` end to end from an actual terminal against the built server, opening an actual browser tab; **both modes explicitly** — windowed footer never hides, fullscreen footer hides on real inactivity and reappears on a real mouse move/keypress, checked by observing the actual screenshots over time, not assumed from the component test; desktop 1280×900 and mobile 390×844, both themes

## On completion

The **Skald** row is already removed from `PLAN-99-future-backlog.md`'s "Owner-reviewed additions" table — that happens as part of scheduling this plan, not deferred here. Archiving this file into `completed/` happens in this plan's own implementation PR.
