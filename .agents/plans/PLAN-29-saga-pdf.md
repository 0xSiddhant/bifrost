# PLAN-29 — Saga: PDF slides

## Goal

Extend Saga (PLAN-28) with a second slide source: a dropped or CLI-served `.pdf` file, each page rasterized to a canvas image and navigated with the exact same shell PLAN-28 already built (keyboard/touch/fullscreen/shortcuts). No reveals, no presenter notes — both are markdown-native concepts with nothing to map to on a rasterized page, not omissions to fill in later.

This is deliberately its own plan rather than a PLAN-28 task: it isn't from deckrun (deckrun is markdown-only) and it reuses nothing PLAN-28 already has (no existing PDF/canvas-rendering pipeline anywhere in this codebase) — a real new dependency and a real new rendering path, on top of a plan that was otherwise built entirely from reused pieces.

## Gate

PLAN-28 merged. Single PR.

## Verified against the codebase, not assumed

- PLAN-28's `loadSource.ts` and `SagaPage.tsx` are the two files this plan actually touches for wiring; everything else (`useSlideshowNav`, `Dropzone`, `ShortcutsOverlay`, the CLI's `commands/saga.ts` and `core/localServe.ts`) is extended in place, not replaced — confirmed against PLAN-28's own file list rather than assumed.
- `client/package.json` has no PDF-rendering dependency today (checked directly) — `pdfjs-dist` is a genuinely new addition, not a package already available to lean on.

**Mandated spike, before the rendering approach is finalized**: `pdf.js` requires a separate worker script (`GlobalWorkerOptions.workerSrc`, in the documented API — not yet confirmed against the actually-installed version here) and bundler integration for that worker is a known rough edge across build tools generally. Confirm `pdfjs-dist`'s worker actually loads and renders a real multi-page PDF correctly against the **built** client bundle (this project's own standing rule — verify against `npm run build` output, never just `npm run dev`), not only in dev mode. If it loads cleanly, the plan proceeds as designed below. If Vite's bundling of the worker script needs special handling (an explicit `?url` import, `new URL(..., import.meta.url)`, or a `vite-plugin-static-copy`-style asset step), that becomes a stated task-list item, not a silent surprise found during implementation. If the worker cannot be made to load reliably at all, the documented fallback is pdf.js's own main-thread rendering mode (`disableWorker`, real API, at a performance cost) — named here as the explicit fallback branch, not left unstated.

## Scope

**In:**
- A dropped `.pdf` file on `/saga`'s landing page, rendered page-by-page as slides.
- `bifrost saga <file>` (PLAN-28's CLI command) accepting `.pdf` the same way it accepts `.md`.
- The exact same navigation shell PLAN-28 already built — keyboard, touch, fullscreen, shortcuts overlay — reused unchanged.

**Out:**
- Presenter notes and incremental reveals on PDF slides — no markdown source to carry either concept; the notes panel and its toggle simply don't appear when the current slide has no note to show, matching how PLAN-28 already handles a markdown slide with no note.
- Text selection or search within a PDF slide. It's a rasterized image, not text — a real, honest limitation of the page-per-slide-image approach, not a bug.
- Saving a PDF as a Bifrost document, or any server-side PDF storage. PDFs are drop/CLI-only, exactly like PLAN-28's `.md` drop path — there is no "saved PDF" concept anywhere in this codebase to extend.
- Presenting a saved Edda's PDF *export* (PLAN-20's HTML/PDF export) through this path. That export is an outbound artifact, not something retrievable by slug; nothing here changes that.

## Decisions & reasoning

### `loadSource.ts` gains real content-type branching

PLAN-28's loader always assumed markdown text. This plan gives it a real fork: a dropped `File`'s own `.type`/extension, or — for the CLI path — the `Content-Type` response header `core/localServe.ts` already sets per extension (extended here to also send `application/pdf` for `.pdf`). A `.pdf` source branches to a new `loadPdfSlides.ts` instead of `parseSlides.ts`; everything downstream (`SagaPage`, the navigation hook, fullscreen, the shortcuts overlay) is unchanged, because both loaders converge on the same "list of slides, current index" shape the shell already consumes.

### "The current slide" now has two real shapes — stated explicitly, not left implicit

PLAN-28 never had to distinguish; every slide was a markdown render. This plan is exactly the situation PLAN-28's own self-review checklist (and the project's `new-plan` skill) warns against papering over: `NotesPanel` and `ShortcutsOverlay` both touch "the current slide," and now that can mean a markdown slide (has a note, maybe) or a PDF page (never has one). Both components branch explicitly on which shape the current slide is, rather than assuming the markdown shape everywhere — `NotesPanel` renders nothing for a PDF-page slide, by the same "no note, no panel" rule PLAN-28 already has, not a new special case.

### Bounded canvas resolution — a large PDF cannot be allowed to spike browser memory unboundedly

Rendering every page at a PDF's own native resolution (some decks embed print-resolution images) risks the same class of problem PLAN-25's decompression-bomb guard exists for, just client-side instead of server-side: an unbounded amount of memory going into canvases nobody asked for at that size. Each page renders at a scale fit to the current viewport (recomputed on resize/fullscreen-toggle), with a stated maximum canvas dimension as a hard ceiling regardless of viewport size — a real, named bound, not an assumption that "reasonable PDFs" will stay small.

### CLI: one more accepted extension, nothing else changes

`commands/saga.ts`'s extension check gains `.pdf` alongside `.md`/`.markdown`; `core/localServe.ts` sends `Content-Type: application/pdf` for it. The local-server mechanism itself (single-request-then-close, origin-scoped CORS, 60s timeout) is exactly PLAN-28's, unmodified — this plan extends what it's allowed to serve, not how it serves it.

## API contracts

None. Still the same `saga` capability-only module from PLAN-28; nothing about PDF rendering happens server-side.

## Task checklist

**Dependency**
- [ ] `client/package.json`: add `pdfjs-dist`, lazy-loaded (its own chunk, only pulled in when a `.pdf` source is actually detected — matching how Loki already code-splits Prettier/Terser)
- [ ] Resolve the mandated worker-loading spike against the **built** client bundle; record which branch was taken (default worker vs. `disableWorker` fallback) in the task list, not just "we checked"

**Feature (`client/src/features/saga/`)**
- [ ] `loadSource.ts`: content-type branch — `.pdf`/`application/pdf` → `loadPdfSlides.ts`, everything else → PLAN-28's existing `parseSlides.ts` path
- [ ] `loadPdfSlides.ts`: one canvas render per page via `pdfjs-dist`, scaled to fit the viewport with a hard maximum canvas dimension
- [ ] `SlideView.tsx`: branches on slide shape (markdown vs. rendered PDF-page canvas/image)
- [ ] `NotesPanel.tsx` / `ShortcutsOverlay.tsx`: explicit no-note branch for a PDF-page slide (not an implicit fallthrough)

**CLI (`cli/src/`)**
- [ ] `commands/saga.ts`: extension check gains `.pdf`
- [ ] `core/localServe.ts`: `Content-Type: application/pdf` for a `.pdf` source

**Docs**
- [ ] `architecture.md`: extend Saga's paragraph with the PDF source and the bounded-canvas note
- [ ] Root `README.md`'s Saga bullet: mention PDF alongside markdown
- [ ] `decisions.md` / `progress.md`: log the spike's actual outcome once run
- [ ] `context-sync` pass once implemented; archive this plan file into `completed/` in the implementation PR

## Acceptance criteria

1. Dropping a real multi-page PDF on `/saga` renders each page as its own slide, in page order, navigated with the exact same keys/touch/fullscreen PLAN-28 already ships.
2. `bifrost saga deck.pdf` opens a real browser tab presenting that exact file's pages end to end.
3. The notes panel and its toggle affordance do not appear on a PDF-page slide; the shortcuts overlay still opens and lists the same bindings regardless of source.
4. The pdf.js worker loads and renders correctly against the **built** client bundle (`npm run build` output), not only under `npm run dev` — closing the mandated spike, with the actual branch taken (default worker vs. fallback) stated in `decisions.md`.
5. A large or high-resolution multi-page PDF does not spike browser memory unboundedly — verified by an actual measurement against the stated maximum canvas dimension, not assumed from the scaling logic's existence.
6. `.pdf` support adds no server-side route, table, or persisted state — confirmed by the diff.

## Test checklist

- [ ] Unit `loadPdfSlides.test.ts` — a real small fixture PDF, page count → slide count, canvas dimensions respecting the stated maximum
- [ ] Component — `SlideView`'s markdown-vs-PDF branch, `NotesPanel`'s no-note-on-PDF-slide behavior
- [ ] Live-verify: a real multi-page PDF dropped in a real browser (built client, not dev server) — page count matches slide count, navigation and fullscreen work identically to the markdown path; `bifrost saga <file>.pdf` end to end from a real terminal; desktop 1280×900 and mobile 390×844
