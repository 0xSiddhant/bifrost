# PLAN-11 — Edda (markdown editor · live preview · library)

## Goal

A full-width markdown workspace at `/edda`: CodeMirror editor pane + live-rendered preview pane, save to a dedicated library, and three share surfaces — editor URL, public rendered preview, raw download API. Named for the Norse manuscripts that preserved the myths: each saved document is an edda.

## Gate

Starts after PLAN-10 is merged (normal numeric order). Reuse dependencies all exist: `core/ui/JsonEditor` (gains a markdown mode), the PLAN-03 marked+DOMPurify render path, `core/relics` name bank (5 worlds), the Runestone library pattern (slugs, 301, creative 404, save flow, `X-Bifrost-Device` author), highlight.js, SSE hub, audit-log subscriber.

## Scope

**In:** `edda` module (both profiles) — editor+preview page, perf-budgeted live preview, mobile single-pane toggle (preview unmounted while editing), save/rename/delete + separate library page, slug URLs + public preview page + download API, formatting toolbar + keyboard shortcuts, outline panel, approximate scroll sync, stats bar, `.md`/`.html` export, creative 404, localStorage scratch draft, coming-soon footer section.
**Out (PLAN-99):** Mermaid diagrams, paste-image upload, PDF export, unified cross-tool library shell. These are named in the page's coming-soon section but not built.

## Decisions & reasoning

- **Editor = the shared CM6 editor with a markdown mode.** Extend `core/ui/JsonEditor` (or extract a `CodeEditor` base + thin wrappers — implementer's call, but ONE shared editor core) with `@codemirror/lang-markdown`: heading/emphasis/link/code syntax tinted via the existing `--syn-*` tokens. History, imperative handles, and the `highlights`/`plain` machinery hardened in PLAN-07/08 carry over untouched.
- **Preview = the PLAN-03 renderer, upgraded to editor grade:** marked with GFM (tables, task lists, strikethrough), highlight.js on fenced code, heading anchor ids (feeds the outline + deep links), DOMPurify always — sanitization is non-negotiable even on a trusted LAN. One pure `renderMarkdown(md) → safeHtml` in `core/markdown/` shared by the live preview, the public preview page, and the HTML export (three surfaces, one renderer, zero drift).
- **Perf model (the owner's core requirement — Variant's budget philosophy applied):**
  - Live preview re-renders on a ~200 ms idle debounce, applied inside `requestAnimationFrame`; typing never triggers synchronous render work.
  - `EDDA_LIVE_PREVIEW_MAX_KB` (env, default 300): above it, live preview auto-degrades to **manual mode** — a "Refresh preview" button + "large document" notice; typing cost returns to ~zero. Below it, live stays on. User can also pin manual mode via a toggle.
  - `EDDA_MAX_DOC_KB` (env, default 2048) caps the document like Runestone's cap.
  - **Mobile: the preview component is unmounted, not hidden.** Single pane + a toolbar toggle (Edit ⇄ Preview); switching to Preview renders once from the current buffer; switching back destroys it. Zero render/memory cost while editing on a phone — per owner spec.
- **Layout: true full width.** Editor | preview split with a draggable divider (50/50 default, min 30% either side, position remembered per session), breaking out of the 62rem shell to the full viewport minus gutters at ≥1024px — extending Variant's breakout precedent to its logical end for prose. Below 1024px: stacked → below 768px: single-pane toggle mode.
- **Own module, own table — no coupling to Runestone.** `eddas` table in `core/db/schema.ts` (id 6-char base36, name, unique slug, content, author_device_id, size_bytes, created/modified) + migration. Writing markdown into `runestones` would pollute Pensieve's JSON semantics (422-on-invalid-JSON, raw-JSON API). Patterns are shared; storage is not. Separate library page per owner decision.
- **Three URL surfaces (owner spec — `preview` and `api` literally in the path):**
  - `/edda/<slug>` — opens the **editor** loaded with the document. **On mobile this URL opens in Preview mode by default** (reader intent on a phone), one tap to Edit.
  - `/edda/preview/<slug>` — public **read-only rendered page**: clean typography, theme-styled, outline in a side rail on desktop, an "Open in editor" affordance, no chrome beyond that.
  - `/edda/api/<slug>` — raw `text/markdown; charset=utf-8` (CORS `*`, stale slug → 301 to canonical, 404 unknown — mirrors Runestone's public API); `?download=1` adds `Content-Disposition: attachment; filename="<name>.md"`.
  - Reserved first segments (`preview`, `api`, `library`) are guarded in slug resolution; slugs always end in `-<id>` so collisions are structural non-issues, but the guard is explicit.
- **Save/rename/share flow = Runestone's proven shape:** relic-generated default names (5-world bank), rename only in the editor title (reslug + 301 on old), dirty tracking, save clears the scratch draft, `edda.saved`/`edda.deleted` bus events → SSE + audit-log subscription, save-burst kill test required. Scratch editor at `/edda` keeps the debounced localStorage draft + restore toast.
- **Toolbar + shortcuts:** bold, italic, strikethrough, H1–H3, link, inline code, code fence, quote, bullet/numbered/task list, table snippet; ⌘B/⌘I/⌘K(+link) etc. All operate through CM transactions (selection-aware wrap/unwrap), pure helpers in `core/markdown/commands.ts`, unit-tested.
- **Outline panel:** heading tree parsed from the same render pass, click → editor jump (and preview jump when visible); collapsible; hidden <768px behind a toolbar button.
- **Scroll sync: approximate by design.** Percentage-based editor→preview mapping with a small heading-anchor correction, toggleable, and explicitly documented as approximate — chasing exact sync across mismatched pane heights is a tarpit; not worth it (logged as a scoped decision so future-us doesn't reopen it).
- **Stats bar:** words · characters · reading time (~200 wpm) · doc size vs cap, debounced with the render tick.
- **Export:** `.md` (buffer as-is) and `.html` — a self-contained file (inlined minimal theme CSS from current tokens + rendered body) so it opens anywhere.
- **Coming-soon footer (owner spec):** a small section at the bottom of the Edda page — "Coming soon: Mermaid diagrams · image paste · PDF export" — content driven by a plain array so removing a shipped item is a one-line change. No links, no promises of dates.

## API contracts (module `edda`)

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/edda` | Library listing | `{ items: [{id, name, slug, author, createdAt, modifiedAt, sizeBytes}] }`; `q`, `author`, `sort`, `order`, pagination — mirrors Runestone's contract |
| `POST /api/edda` | Save new | `{ name?, content }`; name defaults to relic title; 413 over `EDDA_MAX_DOC_KB` |
| `GET /api/edda/:slug` | Fetch for editor | stale slug → 301 canonical; 404 → creative 404 |
| `PUT /api/edda/:id` | Update content/name | rename reslugs; bumps modifiedAt |
| `DELETE /api/edda/:id` | Delete | confirm in UI |
| `GET /edda/preview/:slug` | Public rendered page | SPA route; content via the fetch above |
| `GET /edda/api/:slug` | Raw markdown | `text/markdown`, CORS `*`, 301 stale, 404 unknown; `?download=1` → attachment |
| SSE | `edda.saved` / `edda.deleted` | library live refresh; audit-log records |

## Task checklist

**Core**
- [ ] Markdown mode in the shared editor (lang-markdown + `--syn-*` mapping); extraction to a base only if it stays behavior-identical for JSON/plain consumers
- [ ] `core/markdown/`: `renderMarkdown` (marked GFM + highlight.js + heading ids + DOMPurify), `outline(md)`, `commands.ts` (toolbar transactions), `stats(md)` — all pure, all unit-tested
- [ ] Env keys `EDDA_MAX_DOC_KB`, `EDDA_LIVE_PREVIEW_MAX_KB` in zod config + `.env.example`

**Server**
- [ ] `eddas` table + migration (db-migration skill: schema + migration as one unit); repository port + Drizzle impl; usecases save/update/get/list/delete; routes per contract; reserved-segment guard; bus events; audit pickup
- [ ] Public raw endpoint with CORS/301/404/`?download=1`

**Client**
- [ ] `/edda` page: split layout, draggable divider, full-width breakout ≥1024px, stacked <1024px, single-pane toggle <768px with preview unmount
- [ ] Live preview with debounce+rAF, manual-mode degradation over the KB threshold, pinned-manual toggle
- [ ] Toolbar + keyboard shortcuts; outline panel; approximate scroll sync (toggleable); stats bar
- [ ] Save/dirty/rename flow, library page (search/author/sort/SSE refresh/delete), creative 404 with "Write it now", scratch draft + restore
- [ ] `/edda/preview/:slug` rendered page; mobile default-preview behavior for `/edda/:slug`
- [ ] Export `.md` + self-contained `.html`; coming-soon footer section
- [ ] Nav entry via capabilities

## Acceptance criteria

1. Typing in a small doc updates the preview within ~a debounce tick; typing in a **2 MB fixture** (generated: heavy tables + code fences) never blocks the input — keystroke latency stays fluid, live preview has auto-degraded to manual mode with the notice, and "Refresh preview" renders without hanging the page. Verified via the live-verify ritual with timings recorded.
2. On a phone viewport: editing shows no preview component in the DOM at all; toggling renders it once; toggling back removes it. `/edda/<slug>` opens in Preview mode by default on mobile, Edit one tap away.
3. Desktop uses full viewport width ≥1024px; divider drags and persists; no horizontal overflow at 390px.
4. Save → library row appears on a second device via SSE without reload; open from library lands in the editor with content; rename reslugs and the old slug 301s everywhere (editor fetch, preview page, raw API).
5. `/edda/preview/<slug>` renders clean, sanitized, theme-styled HTML with a working outline; `<script>` in a document renders inert on every surface. `/edda/api/<slug>` returns raw markdown with correct content-type + CORS; `?download=1` downloads `<name>.md`.
6. Toolbar buttons and ⌘-shortcuts produce correct markdown around selections (wrap + unwrap round-trip); outline clicks jump both panes; exports open standalone.
7. Kill test: SIGINT during a save burst → restart → every acknowledged doc intact, integrity ok.
8. Coming-soon section lists exactly the three parked features.

## Test checklist

- [ ] Unit: renderMarkdown sanitization corpus (script/style/event-handler injection), outline extraction, command wrap/unwrap round-trips, stats, slug reserved-segment guard
- [ ] Integration: CRUD + 301 + 413 + raw API headers (content-type, CORS, attachment) + audit pickup via inject; save-burst kill test
- [ ] Component: debounce/manual-mode threshold behavior, mobile unmount assertion (preview absent from DOM while editing)
- [ ] Manual (live-verify skill): 2 MB fixture typing pass on system + phone viewport, real-device pass owed as usual
