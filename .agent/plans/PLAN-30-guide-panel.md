# PLAN-30 — Guide panel

## Goal

A bulb-icon button in the app header — visible only on a page that has one — opening a right-side slide-out panel with a short, static reference on the format that page works with: JSON on Runestone, Markdown on Edda, XML on Atlas, YAML on Groot, JavaScript on Loki, Brotli on the Brotli page. Content is real `.md` files bundled with the client and rendered through the same `renderMarkdown`/`MarkdownPreview` pipeline Edda already uses — "a quick recap of the technology," general and format-wide, not a live analysis of whatever's currently open (Groot's existing advisory rail already does that job for the document in front of you; this plan's Groot guide is the general background beside it, not a replacement). Every fenced code example in a guide gets a copy button, a small, reusable addition to `MarkdownPreview` itself that every existing markdown surface inherits along with it.

## Gate

PLAN-29 merged. Single PR, no parts.

## Verified against the codebase, not assumed

- `client/src/app/App.tsx` (lines ~230–249): the header's real order is wordmark → nav → an optional `OfflineModeToggle` → `ThemeSwitcher`. "Before the theme icon" places the new button between those two, always rendered last-but-one regardless of whether the offline toggle is showing.
- `client/src/core/ui/icons.tsx`: scanned the full 40+ icon export list — no bulb/lamp icon exists today. A new `LightbulbIcon` is a real addition, following the file's own `(p: IconProps) => (...)` shape.
- `client/src/core/ui/Button.tsx`: a plain `variant`/`size` prop API (`ghost`/`icon` is exactly what `ThemeSwitcher` already uses for its own header button) — the guide button reuses this component directly rather than inventing a second button primitive.
- `client/src/features/edda/MarkdownPreview.tsx`: read in full. It is already the shared presentation shell for Edda's live preview *and* its public preview page (its own doc comment says so), already runs the mermaid pass via `useMermaidDiagrams(innerRef, html, 'edda')`, and is otherwise a small, single-purpose component (`dangerouslySetInnerHTML` plus the memoization note about object identity — load-bearing, not decorative). It is the exact right shape to reuse for the guide panel, but it lives under `features/edda/`, and a `core/ui/` component reaching into a feature folder would be backwards — `core/` is the shared layer features depend on, not the other way around. It needs to move to `core/ui/`, not be duplicated or reached into.
- `client/src/core/markdown/useMermaid.ts`: read in full — this is the exact precedent for "a hook that runs an imperative DOM pass over a rendered-markdown container after every commit," including the theme-change re-run via a `MutationObserver` on `data-theme`. The new copy-button behavior is modeled on this file's shape directly, not invented fresh.
- `client/src/core/markdown/render.ts`: `renderMarkdown(md: string): string` — takes raw markdown, returns sanitized HTML (marked GFM + highlight.js + DOMPurify, per its own established pipeline). Guide content goes through this unchanged; code blocks arrive already syntax-highlighted by highlight.js, wrapped in `<pre><code class="language-...">`.
- `.agent/plans/PLAN-25-brotli.md`: confirms the Brotli page's real intended route, `/brotli` (not yet implemented — PLAN-25 is still plan-only). Pre-registering its guide entry ahead of that page existing is the same move this codebase already made once: `core/library/types.ts`'s own comment records that `'groot'` was named in the `LibraryKind` union before PLAN-19 shipped it, specifically so Groot's later arrival cost one array element rather than a type change plus a page. A route→guide-id entry for `/brotli` sits harmless and unused until that page exists.
- `client/vite.config.ts`: confirms Vite is the build tool with no custom asset-loader config beyond what ships by default — Vite's built-in `?raw` import suffix (loads a file's contents as a plain string at build time, no plugin needed) is standard, unmodified behavior here, not something this plan has to configure.

## Scope

**In:**
- A `LightbulbIcon` header button, route-aware, rendered only on a page with a registered guide.
- Six guides: JSON (Runestone), Markdown (Edda), XML (Atlas), YAML (Groot), JavaScript (Loki), Brotli (pre-registered for the not-yet-shipped `/brotli`).
- Each guide is a real `.md` file, bundled client-side, rendered through the shared `MarkdownPreview` — plain reference content, not deckrun's insert-at-caret interactivity (explicitly declined this session: "no need for interaction, it's for user to get a quick recap").
- At least one fenced code-block example per guide, each with its own copy button.
- The copy-button mechanic lands on `MarkdownPreview` itself (promoted from `features/edda/` to `core/ui/`), so every existing consumer — Edda's live preview, its public preview page, and the guide panel — gets it, not a guide-only special case.

**Out:**
- Any live, document-aware content. Every guide is static reference text about the *format*, unrelated to whatever is currently open in the editor — Groot's advisory rail (PLAN-19) already owns the "your specific document has a problem" job for YAML, and this plan's Groot guide sits beside it as general background, not a duplicate or a replacement of it.
- Deckrun's insert-at-caret snippet mechanic — considered directly (it's what the reference screenshot actually does) and explicitly declined this session.
- A guide for Pensieve, Variant, or any non-format-specific page. The button's whole premise is "the format this page works with" — a diff tool or a document library has no single format to explain.
- Server-side storage or an API route for guide content. It is static, build-time-known text with no reason to leave the client bundle.
- Copy buttons on `features/previews/viewers.tsx`'s `MarkdownViewer` (the `.md` file-preview-modal viewer). It is a **separate, pre-existing implementation** of the same render-plus-mermaid shape — not a consumer of `MarkdownPreview` — confirmed by reading it directly rather than assumed from the name. Unifying it with `MarkdownPreview` would be a real, independent refactor with its own justification; this plan promotes and extends `MarkdownPreview` for the two consumers that already share it, and does not fold in a third, differently-shaped file it happens to resemble.

## Decisions & reasoning

### `MarkdownPreview` moves to `core/ui/` — a real promotion, not a new duplicate component

Two real consumers now need the exact same "render sanitized HTML, run the mermaid pass, look like a markdown preview" shell: Edda (already) and the guide panel (new). This codebase's own established rule for exactly this situation — "when two places genuinely need the same small thing, say explicitly whether it moves to `core/` or gets duplicated" — resolves cleanly here: nothing about `MarkdownPreview` is Edda-specific (its mermaid pass already takes a `module` string precisely so more than one caller could use it; the guide panel passes `'guide'` rather than `'edda'`), so this is a move, not a fork. `features/edda/EddaPage.tsx` and `EddaPreviewPage.tsx` update their own import path; the file's content and behavior are otherwise unchanged.

### Guides are bundled client assets, not server files — a deliberate rejection of the alternative

The owner asked directly which side these files should live on. Server-hosted content was considered and rejected: every one of Runestone/Edda/Groot/Atlas is already in the offline-mode warm-load registry specifically because they're pure-client-compute pages that keep working with no server round-trip once loaded — a guide fetched from a server route would be the one part of an otherwise fully-offline-capable page that silently stops working the moment the LAN drops, which is a real regression from a promise those pages already make. Nothing about static, build-time-known reference text needs a server at all; `client/src/assets/guides/*.md`, imported with Vite's built-in `?raw` suffix and dynamically `import()`ed only when a bulb button is actually clicked (so a guide nobody opens never costs anyone's bundle a byte), is the simpler mechanism and the one that keeps the existing offline guarantee intact rather than quietly breaking it.

### Route-aware, not page-aware — one small registry, not five copies of the same wiring

`GuideButton` lives once, in the header, for every route — it does not get mounted per-page. A small `client/src/core/guide/registry.ts` maps a route prefix to a guide id (`'/runestone'` → `'json'`, `'/edda'` → `'markdown'`, `'/atlas'` → `'xml'`, `'/groot'` → `'yaml'`, `'/loki'` → `'javascript'`, `'/brotli'` → `'brotli'`), read via `useLocation()` (the same hook this codebase's own nav-tab-matching logic already uses). No match — Midgard, Pensieve, Variant, anywhere else — means the button renders nothing at all, not a disabled state; there is no guide to point at, so there is nothing to click.

### Groot gets a guide too, alongside its existing advisory rail — two different jobs, not a conflict

Groot's own advisory rail (PLAN-19) already flags the specific traps present in whatever's actually been typed — a live analysis of one document. The guide panel does the opposite kind of thing everywhere else it appears: general background about the format itself, true regardless of what's open. Both fit on the same page without stepping on each other, the same way a language's own reference manual and a linter aren't in tension — Groot's `yaml.md` guide even says so explicitly, pointing at the advisory rail by name rather than silently duplicating what it already does.

### Copy buttons on code blocks: an imperative DOM pass, modeled directly on the mermaid hook's own shape

`useMermaidDiagrams` already establishes the exact pattern this needs: a `useEffect` keyed on `[ref, html, ...]` that walks the just-rendered container and does real DOM work on it, re-running on every commit and on a theme change. A new `useCodeCopy(ref, html)` (`core/markdown/useCodeCopy.ts`, calling a pure `attachCodeCopyButtons(container)` in `core/markdown/codeCopy.ts`) does the same shape for `<pre>` blocks: inject one button per un-processed block, then a **single delegated click listener** on the container (not one listener per block) that resolves the clicked button's owning `<pre>`, reads its `<code>` element's `textContent` (the raw source, never the syntax-highlighted markup), and writes it via `navigator.clipboard.writeText`. The click feedback is the same clipboard→checkmark, 1.5-second icon swap this codebase already uses twice (Pensieve's curl button, Portkey's copy-link) — a third use of an already-proven interaction, not a new one. Called from `MarkdownPreview` beside the existing mermaid hook, so it rides along automatically on every current and future `MarkdownPreview` consumer — Edda's live preview and public page included, a deliberate, considered side effect of promoting the component rather than an accidental scope expansion, called out explicitly here.

### Panel shape: a right-side slide-out drawer, matching the owner's own reference image — not a centered modal

The screenshot that prompted this plan (deckrun's own "Everything you can put on a slide" panel) is a right-edge drawer, not a dialog in the middle of the screen — `GuidePanel` matches that: fixed to the right edge, slides in, closes on an `×`, `Escape`, or a click outside (the same outside-click/`Escape` pattern `ThemeSwitcher`'s own popover already uses, read directly rather than assumed). It does not block interaction with the rest of the page the way Heimdall's modal deliberately does — this is reference material to glance at while working, not a gate to clear.

## API contracts

None. No server route, table, or module changes anywhere in this plan — every guide is a static client asset, and the copy-button mechanic is pure client DOM/clipboard work.

## Task checklist

**Core (`client/src/core/`)**
- [ ] `core/ui/icons.tsx`: new `LightbulbIcon`
- [ ] `core/ui/MarkdownPreview.tsx`: moved from `features/edda/MarkdownPreview.tsx` (content unchanged beyond the import path); `features/edda/EddaPage.tsx` and `EddaPreviewPage.tsx` updated to import from the new location
- [ ] `core/markdown/codeCopy.ts`: `attachCodeCopyButtons(container)` — one button per `<pre>`, one delegated click listener, clipboard→checkmark icon swap (1.5s)
- [ ] `core/markdown/useCodeCopy.ts`: mirrors `useMermaid.ts`'s shape exactly; called from `MarkdownPreview`
- [ ] `core/markdown/index.ts`: barrel export addition
- [ ] `core/guide/registry.ts`: route-prefix → guide id map, six entries including `'/groot'` → `'yaml'`; `'/brotli'` entry included even though that route doesn't exist yet
- [ ] `core/guide/GuideButton.tsx`: `useLocation()`-driven; renders nothing when no guide matches the current route; dynamically `import()`s the matched guide's `.md?raw` content only on first open
- [ ] `core/guide/GuidePanel.tsx`: right-side drawer, outside-click/`Escape` close, renders the fetched content through `MarkdownPreview`

**Content (`client/src/assets/guides/`)** — written ahead of the rest of this plan, at the owner's explicit request, so wiring is the only work left here; each file already includes at least one fenced, copyable example
- [x] `json.md` — the six data types, no comments, no trailing commas, double-quoted keys only, no int/float distinction, duplicate-key ambiguity
- [x] `xml.md` — elements vs. attributes, one root element, entity escapes, CDATA, self-closing tags, case sensitivity, well-formed vs. valid
- [x] `markdown.md` — headings/emphasis/lists/links/code fences/tables/blockquotes, the sanitized-HTML note, the `---` ambiguity (horizontal rule vs. front matter vs. Saga's slide break)
- [x] `yaml.md` — indentation significance, the `yes`/`no`/`on`/`off` boolean trap (cross-references Groot's advisory rail by name), numbers/dates auto-parsing, anchors/aliases, flow-vs-block style, the `---` multi-document marker
- [x] `brotli.md` — what Brotli is, comparison to gzip, quality/window-size knobs, browser-decompresses-but-can't-compress, stream-not-archive, the decompression-bomb note (ties to PLAN-25's own output cap)
- [x] `javascript.md` — dynamic typing, `==` vs. `===`, `undefined` vs. `null`, truthy/falsy, `NaN !== NaN`, hoisting by declaration kind, closures

**Wiring**
- [ ] `App.tsx`: `<GuideButton />` added between the optional `OfflineModeToggle` and `ThemeSwitcher`

**Docs**
- [ ] `architecture.md`: a short paragraph on the guide mechanism and the `MarkdownPreview` promotion
- [ ] `decisions.md` / `progress.md`
- [ ] `context-sync` pass once implemented; archive this plan file into `completed/` in the implementation PR

## Acceptance criteria

1. The bulb button appears on `/runestone`, `/edda`, `/atlas`, `/groot`, and `/loki`, and is absent on Midgard, Pensieve, and Variant — verified by navigating to each and checking the header directly, not assumed from the registry.
2. Clicking the bulb on each of those five pages opens a right-side panel with that page's real, matching content — JSON facts on Runestone, XML on Atlas, Markdown on Edda, YAML on Groot, JavaScript on Loki — rendered with the same visual treatment as Edda's own markdown preview. On Groot specifically, the panel and the existing advisory rail are both reachable at once and don't visually collide.
3. The panel closes on its `×`, on `Escape`, and on a click outside it.
4. Every fenced code example across the six guides has a working copy button; clicking one copies the block's exact raw text (not the highlighted markup) to the clipboard, confirmed by reading the actual clipboard contents, and shows the same checkmark-swap feedback Pensieve's curl button already uses.
5. The same copy-button behavior appears on Edda's own live preview and public preview page's code blocks — a direct, intended consequence of promoting `MarkdownPreview`, verified rather than assumed.
6. A guide's markdown content is not present in the initial page bundle for a route that never opens its panel — verified by checking the network/chunk request only fires on first click, not on page load.
7. No `/brotli` guide is reachable today (the route doesn't exist yet), but the registry entry is in place and requires no further change once PLAN-25 ships.
8. No file under `server/` changes anywhere in this plan's implementation PR — confirmed by the diff.

## Test checklist

- [ ] Unit `core/markdown/codeCopy.test.ts` — button injected once per `<pre>` (not duplicated on a re-run), delegated click resolves the correct block, clipboard write called with the raw (unhighlighted) text
- [ ] Unit `core/guide/registry.test.ts` — every in-scope route (including `/groot`) resolves to its guide id; an unregistered route resolves to nothing
- [ ] Component `GuideButton`/`GuidePanel` — hidden on a route with no guide, opens/closes correctly (`×`, `Escape`, outside click), lazy-loads content only on first open
- [ ] Component `MarkdownPreview` (moved) — existing Edda tests continue to pass unmodified from their new location, confirming the move changed nothing behavioral
- [ ] Live-verify: the bulb button and its panel on all five real pages (Runestone/Edda/Atlas/Groot/Loki), a real code-block copy verified against actual clipboard contents on at least two different guides, the Groot advisory rail and its guide panel both open together with no layout collision, panel open/close via all three methods, desktop 1280×900 and mobile 390×844, both themes
