# PLAN-20 — Edda: Mermaid diagrams + PDF export

## Goal

Two PLAN-99 Tier B rows, shipped together: fenced ` ```mermaid ` blocks render as real diagrams in every Edda preview surface, and an edda can be exported as a PDF. They share a plan because they share a dependency chain — a PDF that omits the diagrams would be a bug, so the printing path has to be built on top of the diagram path, and building them apart would mean building the export template twice.

**Entirely client-side.** No server module, no route, no table, no migration, no capability change. `edda` already exists in both profiles.

## Gate

PLAN-19 merged. **Single PR** — `feat/plan-20-edda-diagrams-print`. Explicitly no parts, at the owner's instruction.

## Decisions & reasoning

### `renderMarkdown` stays pure and synchronous

`architecture.md` names the property this plan must not break: *"one pure function shared by the live preview, the public page, and the HTML export"*. Mermaid is **async** and needs a **live DOM** to measure text before it can lay a graph out, so running it inside `renderMarkdown` would make that function async and DOM-bound and would break all three consumers at once.

So the renderer's only change is that a ` ```mermaid ` fence emits a placeholder — `<pre class="mermaid-src">` carrying the escaped source — instead of an hljs-highlighted code block. It also gains a pure `hasMermaid(md)` for the lazy-load gate. **A separate async pass swaps the SVG in**, after the HTML is in the DOM.

### Mermaid loads only when a fence exists

PLAN-99's own note, and it is load-bearing: mermaid is roughly a megabyte. `await import('mermaid')` sits behind `hasMermaid`, so an edda with no diagram — which is most of them — pays nothing. An acceptance criterion measures that the Edda page's own chunk does not grow.

### `exportHtmlDocument` becomes async and inlines the rendered SVG

An exported `.html` whose diagram is the literal text `graph TD; A-->B` is a broken artifact, and shipping mermaid's megabyte *into* a standalone export file to avoid that is worse. So the export renders the diagrams first and embeds the resulting SVG markup. Both call sites — the existing `.html` button and the new PDF path — await it.

### PDF prints a generated standalone document in a hidden iframe, not the app page

The alternative was a print stylesheet over the live page. Four reasons this wins:

1. **`exportHtmlDocument` already *is* the clean-document representation.** Printing it makes `.html` and `.pdf` the same artifact — PLAN-11's zero-drift property, extended to a third output instead of forked.
2. **Printing the SPA means hiding the shell**: header, bottom nav, sky relics, the Nótt overlay, the editor pane, the toolbar, the outline rail, the divider. A dozen `@media print` overrides that silently rot every time the shell changes, and nothing fails loudly when one is missed.
3. **It removes the async race structurally.** The iframe's document has its SVGs already inlined, so there is no "wait for every diagram before calling print()" timing hack to get wrong — the document is complete before it exists.
4. Browsers name the saved PDF after the document's `<title>`, which the export already sets to the edda's name.

Mechanics: build the string → `<iframe>` with `srcdoc`, off-screen, same-origin → on load, `contentWindow.print()` → remove on `afterprint`, **with a timeout fallback** because `afterprint` is not reliably delivered in every browser and a leaked iframe per export is a real leak.

### Print forces a paper palette

The export inlines the **active theme's** tokens. Printing an Aurora-dark document either burns a cartridge or — because browsers drop backgrounds by default — prints near-white text on white paper. So the export template gains an `@media print` block that overrides the tokens to ink-on-paper regardless of theme. This also fixes the plain `.html` export for anyone who prints that.

### Mermaid input is untrusted

Any device on the LAN can save an edda, and `/edda/preview/:slug` is a public URL — so a diagram is untrusted markup rendered in **someone else's** browser. Pinned config:

- `securityLevel: 'strict'`
- `htmlLabels: false`
- `suppressErrorRendering: true`
- the `secure` key list left at its default, so an in-document `%%{init: …}%%` directive **cannot raise its own privileges**

Never `securityLevel: 'loose'`, never `click`/`callback` directives. `htmlLabels: false` earns its place three times over: it closes the HTML-in-`foreignObject` surface, `foreignObject` is the part DOMPurify is most likely to strip, and it prints unreliably.

### The SVG is sanitized — and this is the one thing to prove first

Mermaid emits a `<style>` element **inside** the SVG, and DOMPurify's defaults strip `<style>`, which would leave a diagram with no fill or stroke — usually invisible. So: sanitize with an SVG profile that permits a `<style>` scoped inside the `<svg>`, and **verify by rendering real diagrams in both a dark and a light theme before building anything else on top**. If a scoped style block cannot be kept safely, the fallback is to drive colour entirely through `themeVariables` and presentation attributes. Do not assume either way — this is a fifteen-minute spike that decides the shape of the rest.

### Diagrams are cached by source text

The live preview re-renders on a 200ms debounce inside rAF (`EddaPage.tsx:248`). Mermaid's layout is dagre and is not cheap, so re-laying-out every diagram on every keystroke batch would make typing stutter in a diagram-heavy document. Cache keyed on each fence's exact source; only new or changed diagrams re-render.

### Diagrams re-render on a theme change

Mermaid bakes colours into the SVG at render time, so a diagram drawn in Aurora stays dark after a switch to Daybreak and reads as broken. Map Bifrost tokens → mermaid `themeVariables`, read **at render time** (the `QrCard` / screensaver `readColors` precedent), and invalidate the cache when the theme changes.

### Errors are visible and contained

An invalid diagram renders as a bordered block naming the parse error with its source beneath — never a blank gap, and never mermaid's own injected error graphic, which is why `suppressErrorRendering` is on.

### The mermaid module lives in `core/markdown/`, and the file-preview viewer gets diagrams too

`features/previews/viewers.tsx` renders arbitrary `.md` files from `downloads/`/`uploads/` through its **own** pipeline — a bare `marked.parse` + DOMPurify, never `renderMarkdown`. It gets mermaid as well.

The decision that makes this cheap is **where the mermaid pass lives**. Put it in `features/edda/` and `previews` can never reach it — features may not import features, so adding it later would be a move plus a full re-test. Put it in **`core/markdown/mermaid.ts`** from the start, beside `render`/`outline`/`stats`/`commands`, and the second consumer is about ten lines. Doing this now is strictly cheaper than doing it later, which is the whole reason it is in this plan.

The two objections that made this "out of scope" in the first draft both dissolve on inspection:

- *"A megabyte for a preview modal."* The `hasMermaid` gate already handles it — a `.md` file with no fence loads nothing at all, which is nearly every file.
- *"Untrusted input."* Already the posture. A file in `downloads/` is writable by anyone on the LAN, which is the same threat model as a saved edda, and the pinned strict config covers both.

`MarkdownViewer` therefore switches to `renderMarkdown` — which also gets it hljs highlighting, heading ids and GFM for free, closing a real drift between the two markdown surfaces. Its `.preview-markdown` styling must be re-checked, since it has never been through this renderer.

### Explicitly out of scope

- **A dedicated PDF renderer** (pdf-lib / headless print service). PLAN-99's note says browser print first, and a renderer only if that disappoints. It has not disappointed yet.
- **PDF export from the file-preview modal.** It gets diagrams, not a print button — the modal is a quick look at a file, not a document workspace.

### PLAN-99 correction

Both rows say the feature is *"listed in Edda's coming-soon footer"*. **There is no coming-soon footer in the Edda UI** — the note is stale, and there is nothing to remove there. The two PLAN-99 rows themselves are deleted when this plan completes (see On completion).

## Tasks

- [ ] **Spike first:** render three diagram types through DOMPurify in a dark and a light theme; settle the `<style>`-in-SVG question before anything depends on it
- [ ] Dep: `mermaid@^11.16` (client)
- [ ] `core/markdown/render.ts`: ` ```mermaid ` fence → `<pre class="mermaid-src">` placeholder; export pure `hasMermaid(md)`; DOMPurify keeps the placeholder class
- [ ] **`core/markdown/mermaid.ts`** (core, not the feature — `previews` must be able to reach it): lazy loader behind `hasMermaid`, pinned security config, token → `themeVariables` map read at render time, source-keyed cache, `renderMermaidIn(container)`, error blocks
- [ ] `EddaPage`: run the mermaid pass after each preview commit; invalidate on theme change; keep the 200ms/rAF budget intact
- [ ] `EddaPreviewPage`: same pass on the public page
- [ ] `features/previews/viewers.tsx`: `MarkdownViewer` switches from bare `marked.parse` to `renderMarkdown` + the mermaid pass; re-check `.preview-markdown` styling against the new renderer's output (hljs classes, heading ids)
- [ ] `exportHtml.ts`: **async**, SVGs inlined, `@media print` paper palette, break rules (`break-inside: avoid` on `pre`/`table`/`blockquote`/`figure`, `break-after: avoid` on headings), `<!-- pagebreak -->` → forced break
- [ ] `.pdf` toolbar button beside `.md`/`.html`: build → `srcdoc` iframe → `print()` → cleanup on `afterprint` **with a timeout fallback**
- [ ] CSS: `figure.mermaid` (centred, `max-width: 100%`, `height: auto`) + the error block, applied to `.md-preview` **and** `.preview-markdown` from one rule, and mirrored in the export template
- [ ] Failure paths logged per `rules/coding.md` — a diagram that fails to render and an export that throws both get a line
- [ ] Docs sync (`architecture.md` Edda data-flow entry, `project-structure.md`, `decisions.md`, `progress.md`, `plans/README.md`) + archive this file **in this PR**

## Acceptance criteria

1. A ` ```mermaid ` fence containing a flowchart, a sequence diagram and a Gantt chart renders as three diagrams in the live preview, on `/edda/preview/:slug`, in the `.html` export and in the PDF — **all four surfaces, from the same source**.
2. An edda with **no** mermaid fence loads no mermaid chunk at all (checked in the network panel, not by reading the code), and the Edda page's own chunk is no larger than before this plan.
2b. A `.md` file containing a mermaid fence, dropped into `downloads/` and opened in the **file-preview modal**, renders the diagram; a `.md` file without one loads no mermaid chunk. Code blocks in that modal now carry hljs highlighting and headings carry ids, with `.preview-markdown` still laid out correctly.
3. Switching theme with a diagram on screen **recolours the diagram** without a reload; a diagram rendered in Aurora is legible in Daybreak.
4. Typing into a document with five diagrams does not stutter: unchanged diagrams are not re-laid-out (asserted on the cache, plus felt in live-verify).
5. An invalid diagram shows a bordered error block naming the parse error with its source below; the rest of the document renders normally, and mermaid's own error graphic never appears.
6. A diagram containing `<script>`, an `onerror` attribute, a `javascript:` link and an `%%{init: {"securityLevel":"loose"}}%%` directive renders inert — no script runs, and the directive does not take effect.
7. Nothing is fetched from the network while a diagram renders — no CDN font, no remote asset. Bifrost is offline by design.
8. `.pdf` produces a PDF whose diagrams are present and sharp (vector, not raster), whose filename is derived from the edda's name, and which contains **none** of the app shell — no header, nav, toolbar, editor pane or sky relics.
9. The PDF prints **dark text on white** whichever theme is active, including with the browser's "print backgrounds" option off.
10. A code block, a table and a diagram are never split across a page boundary, and a heading never sits alone at the foot of a page. A `<!-- pagebreak -->` forces a break where it appears.
11. A diagram wider than the page scales down to fit instead of being clipped.
12. Exporting twice leaves **no** iframe in the DOM — verified with `afterprint` suppressed, to prove the timeout fallback works.
13. The `.html` export opens correctly with no network and no Bifrost, diagrams included, and prints to the same paper palette.
14. Preview, export and print all work at 375 / 768 / 1280 with no horizontal overflow.

## Tests

- [ ] Unit (`core/markdown`): `hasMermaid` corpus (fence with/without info string, indented fence, inline `mermaid` word, fence inside a code block); the placeholder survives DOMPurify with its class and escaped source intact; a non-mermaid fence still highlights
- [ ] Unit (`core/markdown/mermaid`): cache reuses an unchanged source and re-renders a changed one; theme change invalidates; a throwing render yields an error block, not an exception
- [ ] Unit (`exportHtml`): output contains inlined `<svg>` and no `mermaid-src` placeholder; the `@media print` block is present; `<!-- pagebreak -->` becomes a break element
- [ ] Component: the preview runs the mermaid pass after commit and does not run it for a document with no fence; `MarkdownViewer` renders a fence as a diagram and a plain file unchanged
- [ ] Live-verify (`live-verify` skill): the four surfaces from one source in both themes, **plus the file-preview modal on a real `.md` dropped into `downloads/`**; the hostile-diagram case from criterion 6; network panel proving no mermaid chunk without a fence and none fetched during render; **PDF actually generated headlessly via CDP `Page.printToPDF` and inspected** — diagrams present, no shell, ink-on-paper; iframe cleanup with `afterprint` suppressed; zero console errors
- [ ] Manual: a real phone on the LAN — diagram legibility at 375px, and the OS print/share sheet

## On completion

**PLAN-99 is already clean** — the owner had both rows stripped on 2026-08-04 when this plan was written, rather than at completion, so a backlog row for scheduled work never sat around to be misread as still-open. A `PROMOTED … to PLAN-20` note points here in their place.

So this PR's only paperwork is the docs sync in Tasks plus **archiving this file to `.agent/plans/completed/`** — a plan's own PR closes its own paperwork, the same rule as PLAN-18. Optionally flip the PLAN-99 note from `PROMOTED` to `DONE` at the same time.
