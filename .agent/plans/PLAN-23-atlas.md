# PLAN-23 — Atlas (XML editor with an editable, plist-aware Xcode-style table)

## Goal

A 4th structured-document editor on Ollivanders, alongside Runestone
(JSON), Edda (Markdown) and Groot (YAML): a general XML editor that, when a
document is an Apple property list (`<plist>` root), shows a genuinely
**editable** structured view shaped like Xcode's own Property List editor —
a Key/Type/Value table, alongside the raw markup, where you can
expand/collapse, change a row's type via dropdown, edit values, and
add/delete/reorder rows, not just look at them. Joins the shared Pensieve
library as a 4th document kind — the extension point PLAN-21 built for.

**Named Atlas** (Greek — holds the whole structure up; picked over
Nornir/Grimoire/Moirai specifically for being the easiest to say and spell).

**The table started this discussion as read-only, then was explicitly
reopened and reversed to fully editable — logged as a reversal, not
silently overwritten**, the same way this codebase's `decisions.md` already
handles a changed mind (e.g. "Supersedes the read-only text result view"
for Variant). What that reversal actually costs, precisely, is broken out
below rather than left as "bigger, vaguely."

**One boundary held from the original, smaller scope**: the table only
ever appears for a detected **plist** document. Non-plist XML gets the code
editor (format/validate/fold, CodeMirror `xml` mode) with no structured
view — plist's fixed, small set of node types (`dict`/`array`/`string`/
`integer`/`real`/`date`/`data`/`boolean`) is what makes a faithful, editable
Xcode-style table tractable at all; arbitrary XML has no such fixed shape,
and a generic "any XML as an editable tree" view was never asked for.

## Gate

PLAN-22 (offline mode) merged — not yet implemented as of this plan being
written, only planned itself. Strict order says Atlas waits behind it.
Single PR — `feat/plan-23-atlas`, no parts, despite the scope this plan
grew into (explicitly discussed and kept as one PR rather than split, since
the read-only/editable line never corresponded to a natural merge
boundary — a temporarily read-only table would just be thrown away a PR
later).

## Decisions & reasoning

### Why not a plist npm library

Every general-purpose plist library (`plist`, `@plist/parse`, etc.) parses
straight to native JS values — `<integer>` and `<real>` both become a JS
`number`, `<string>` and `<data>` are indistinguishable once decoded.
That's exactly the distinction Xcode's table depends on showing correctly,
so a generic library throws away the one thing this feature needs most —
the same "silent data loss" reasoning that ruled out `js-yaml` for Groot.
Instead: parse with the browser's native `DOMParser`, walk the DOM
directly, and keep each node's **declared** XML type (`PlistNode = { type:
'dict' | 'array' | 'string' | 'integer' | 'real' | 'date' | 'data' |
'boolean', ... }`), in a new `client/src/core/xml/` module mirroring
`core/yaml/`'s shape (`index.ts` for parse/validate/format, a plist-
specific sub-module for the typed walk, `advisories.ts`). Zero new runtime
dependency for parsing — `DOMParser`/`XMLSerializer` are native Web APIs.

### The one real new dependency: `@codemirror/lang-xml`

For syntax highlighting/folding, following the exact pattern
`@codemirror/lang-json`/`@codemirror/lang-yaml` already set in
`core/ui/JsonEditor.tsx`'s `modeExtensionsFor`: add `'xml'` to the
`EditorMode` union, a new `xmlModeExtensions()` alongside the existing
four, add `xml` to the two mode-gate booleans (`closeBracketsMode`/
`foldMode`) at the mount effect. Same `^6.x` band as the rest of the
CodeMirror family. Worth knowing, not disqualifying: the package's
upstream GitHub repo was archived in April 2026 — still published and
functionally complete (XML's grammar doesn't need much upkeep), but
nowhere to file a bug.

### The entity-expansion risk needs a spike before anything depends on the answer

YAML's alias-expansion "billion laughs" problem has an XML equivalent —
nested internal general entities can blow up exponentially, entirely
client-side. `DOMParser` does **not** resolve *external* entities (no XXE
risk, standard browser behavior), but whether it also refuses to *expand
internal* ones, or silently expands them the way Groot had to cap with
`maxAliasCount`, is not something to assume — it needs the "prove it, don't
reason about it" treatment PLAN-20 gave the DOMPurify `<style>` question.
**First task of this plan**: feed a crafted internal-entity-bomb document
through `DOMParser` in a real browser and observe what actually happens.

### No multi-document tabs (a real simplification versus Groot)

YAML's `---` stream syntax lets one file hold several documents, which is
why `GrootPage.tsx` has a `docIndex` tab strip. A well-formed XML document
always has exactly one root element, so `AtlasPage.tsx` skips that surface
entirely.

### Layout is a real two-panel split, mirroring Edda — not Groot's toggle

Code and the plist table need to be visible **at the same time**,
independently scrollable, resize behavior matching an existing editor.
Runestone/Groot's `view: 'code' | 'tree'` is a one-or-the-other toggle, the
wrong template — **Edda's** `layout: 'split' | 'stacked' | 'single'` is the
actual match: draggable divider, ratio persisted in `sessionStorage`
(`RATIO_KEY`), clamped `0.3–0.7` (`EddaPage.tsx:138-141`), breakpoints
`split` ≥1024px / `stacked` ≥768px / `single` below with an edit/preview
toggle. Atlas reuses Edda's actual numbers, not a new value — "the same as
other editor" was the ask.

Second consumer of this exact mechanism (Edda is the first) — the point in
this codebase's own history where a shared piece gets extracted rather
than duplicated (`JsonEditor`, `TreeView` both moved to `core/` at exactly
their second consumer). **`core/ui/useSplitPanel`** extracted from Edda's
inline implementation, in its own commit before any Atlas code, Edda
re-verified unchanged — mirroring PLAN-19's `mode` refactor landing "alone
and green first." Touches `EddaPage.tsx` as a small, behavior-preserving
refactor.

### The table is the single mutable source of truth, not a read-only render of one

The reversal to editable changes the data-flow shape; precisely where:

- **The parsed `Document` (the live DOM `DOMParser` produces) is the one
  shared model** — no separate `PlistNode` tree the table renders from
  plus a text buffer the code pane owns independently (two sources of
  truth that would need to agree is exactly the bug class two-way sync
  tends to grow). Code-pane edits re-parse into a fresh `Document`; table
  edits mutate the live `Document` and serialize the **affected span** back
  into the code pane.
- **Value edits are surgical; type/structural edits aren't — an inherent
  property of DOM mutation, not a shortcut.** A text-content change
  replaces only that span, everything else byte-identical, the same
  formatting-preservation bar Groot holds for YAML. A **type** change
  (String→Number, Dictionary→Array) has no "rename this element" DOM
  operation — it's a replacement element, rewriting at least that
  element's own tags, scoped to the smallest enclosing element, never the
  whole document.
- **Undo/Redo needs no new mechanism** — table edits dispatch as real
  CodeMirror transactions (`view.dispatch({ changes: { from, to, insert }
  })`) against the same `EditorView` the code pane uses, via one new
  imperative `replaceRange(from, to, text)` on `JsonEditorHandle`. The
  existing `UndoRedoControl` then works uniformly across both panes with
  no second undo stack.
- **A value field commits on blur/Enter, not per keystroke** — dispatching
  a transaction per character would flood the undo history and thrash the
  code pane's text on every render.
- **A dict-key rename never hard-blocks on a collision** — XML doesn't
  structurally forbid duplicate `<key>` text in one `<dict>`, and it's
  exactly the case the advisory rail already covers. Letting a rename
  produce a duplicate and surfacing the existing advisory is simpler than
  separate blocking validation that would just duplicate it.
- **Changing a scalar's type to Array/Dictionary discards its old value**,
  matching real Xcode (no sensible String→Array conversion exists).
  Between scalar types, convert where there's an obvious reading (Number ↔
  String via parse/stringify), otherwise default to that type's empty/zero
  value.

### Visual design matches Xcode's layout precisely, per the owner's reference screenshot

A real Xcode plist-editor screenshot (`GoogleService-Info.plist`) pins down
specifics beyond "a table with a type dropdown":

- Header row `Key | Type | Value`, thin bottom border, no per-cell
  gridlines elsewhere.
- **Root row is a shaded, distinct group row**: disclosure triangle, the
  document's title, a **disabled** Type control reading "Dictionary" (root
  type isn't changeable), Value column showing an **item count**
  (`(N items)`) instead of an editable value, plus a "+" for a top-level
  entry.
- Leaf rows plain-background, indented one level per nesting depth.
- **Type and Value both carry a small up/down stepper-chevron control**
  (⌃⌄) at their right edge on every row — the one piece of Xcode's exact
  look worth reproducing closely (a generic `<select>` wouldn't read as
  "the Xcode editor").
- **Booleans render as literal "YES"/"NO" text**, never a checkbox or
  toggle switch — Apple's own convention (`<true/>`/`<false/>` render as
  exactly those two words here), and the stepper toggles between them.
- A container row's Value column always shows an item count, never an
  editable field.

### Row reordering — pointer-based drag, matching the divider precedent, not native HTML5 DnD

Drag-to-reorder within both a `<dict>` and an `<array>`, matching Xcode.
Two drag mechanisms already exist in this codebase: native HTML5 DnD (OS
files dropped *onto* the page — file-transfer's upload, and this plan's own
file-import task) and **pointer-event-based dragging** (in-app UI dragged
*within* the page — Edda's split-panel divider tracks `pointerdown`/
`pointermove`/`pointerup` on a ref, not native DnD). Row reordering is the
second kind: a drag handle per row, pointer tracking, a computed insertion
index, `insertBefore` on release. Scopes cleanly with the surgical-edit
principle — reordering touches no child's own content or type, only the
**parent's** child order, so only the parent dict/array's span needs
re-serializing.

### Table view is conditional, code pane is always present

Code panel (CodeMirror, `xml` mode) always shown, stays directly editable
regardless of the table. Table panel only renders when the parsed root is
`<plist>` (Apple's `-//Apple//DTD PLIST ...//EN` doctype, or leniently just
a top-level `<plist>` element — hand-edited plists sometimes omit or
mismatch the doctype line). Non-plist XML: single full-width code pane, no
empty second panel.

### One tool, not two — XML and plist are never separate modes

Atlas is a single editor. Plist is a **detected special case of XML**, not
a parallel tool or a mode switch a user picks — every `.xml`-shaped
document gets the same code editor and toolbar; the table panel appears or
doesn't depending on what's actually in the document.

### Toolbar carries the same weight as the other editors, not just parse/validate

Matching what Runestone/Groot already offer: **Format** (pretty-print via
`formatXml`), **Minify** (collapse insignificant inter-tag whitespace —
XML's equivalent of Runestone's JSON minify), **Copy**, **Undo/Redo**
(`UndoRedoControl`), font-size control (`PanelFontControl`), save/clear.
Format and Minify need real logic in `core/xml/index.ts`, not just hide
inside "format/validate/fold."

### Find/replace needs no work — confirm it, don't build it

`core/ui/JsonEditor.tsx:704-710`: `search({ top: true })` and
`searchKeymap` are wired into the editor's **base** extension list, outside
`modeExtensionsFor`'s per-mode switch entirely. Find, find-next, and
replace are mode-agnostic by construction — the new `xml` mode inherits
them automatically. Nothing to build; still worth an explicit acceptance
criterion so it's actually driven, not just assumed.

### Five additions found by checking what Groot actually ships, not just what was discussed

1. **Drag-and-drop file import — a real parity gap.** `GrootPage.tsx`
   supports dragging a local `.yaml`/`.yml` file onto the page; this was
   missing from Atlas entirely until caught here. Accept `.xml` **and
   `.plist`** extensions.
2. **`.plist` must be recognized, not just `.xml`** — real Apple plists are
   very often literally named `Info.plist`, not `.xml`.
3. **Binary plists need a clear, honest rejection, not a confusing parse
   error.** Most real-world plists on a Mac (compiled `Info.plist`, most
   `NSUserDefaults` files) are the **binary** `bplist00` format, and this
   plan deliberately scopes binary out. A `bplist00` magic-byte sniff →
   "This is a binary plist — convert it first with `plutil -convert xml1`"
   beats a wall of misdescribing XML parse errors.
4. **Clicking a row's key/type (not its value) jumps the code pane to that
   node's source** — the same pattern Groot's advisory rail and
   parse-issue list already use, nearly free since the plist walk already
   tracks source offsets for the surgical-edit spans.
5. **A new/blank Atlas document seeds a minimal valid plist skeleton**
   (`<?xml version="1.0" ...?><plist version="1.0"><dict/></plist>`)
   instead of an empty, immediately-invalid buffer — Xcode never hands you
   a blank file for a new plist either.

Considered and left out: a "Download as `.xml`/`.plist`" button (nothing
else on Ollivanders besides Edda has one; Runestone/Groot rely on the
public API URL and copy/paste) and full keyboard-driven table navigation
beyond click-to-jump (mouse/click editing covers what was asked).

### Advisories are shorter than Groot's, honestly

XML's grammar is strict — most of what YAML treats as an ambiguity worth
flagging is simply a hard parse error in XML. Real candidates: a duplicate
`<key>` inside one `<dict>` (last one wins per spec, same treatment Groot
gives duplicate YAML keys), a `<date>` not in Apple's expected
`YYYY-MM-DDTHH:MM:SSZ` form, and a `<data>` element whose content isn't
valid base64. Not padded to match Groot's count artificially.

### Naming derivatives

- Server module `server/src/modules/atlas/`, DB table `atlas_docs` (module
  + generic noun, the `groot_docs`/`accio_links` precedent).
- Routes `/atlas`, `/atlas/:slug`, `/atlas/pensieve` and `/atlas/library` →
  redirect to `/pensieve?type=atlas` (no separate library page, PLAN-21
  pattern).
- Public raw endpoint `GET /atlas/api/:slug`, outside `/api/`, same
  route-precedence trick as Groot/Edda/Runestone. Content type
  `application/xml; charset=utf-8` for every document regardless of
  plist-ness (Groot/Edda don't vary by sub-format either).
- Config cap `ATLAS_MAX_DOC_KB`, defaulting to Groot's 2048.
- Library kind `'atlas'`, label `"XML"` (format-named, the `core/yaml`/
  Variant-sharing precedent).

### Ollivanders: card colour, and the 7-card layout fix

**Card colour needs nothing new** — `OllivandersPage.tsx`'s cards get
colour from **position** (`<Portal tone={index + 1} .../>`,
`OllivandersPage.tsx:107`); a 7th appended `TOOLS` entry automatically
lands on the next unused slot, zero hardcoded colour, same reasoning
already written for Groot's own addition. Pensieve's kind-badge colour
follows **kind** instead (a scoped, already-established exception) — Atlas
needs a fixed `tone` in its `LIBRARY_REGISTRY` entry, picked after checking
what Runestone/Edda/Groot's entries actually use (Groot confirmed `tone:
3`).

**The 7-card grid needs more than a padding trim.** `.shell-main`
(Ollivanders' container) caps at `max-width: 62rem` with `padding:
var(--space-8) var(--space-6) var(--space-12)` — trimming the inline
padding recovers only a few dozen pixels; the 62rem cap is what actually
limits the `.portals` grid to ~3 columns, why 6 cards already wrap to 2
rows and a 7th pushes to a 3rd. Diagon Alley hit this identical problem
(PLAN-18b) and the fix already exists: `.shell-main--wide` drops the width
cap, keeping only safe-area-aware gutters (`app.css:213-221`). Applying it
to Ollivanders is a one-line change — extend `App.tsx:231`'s
`pathname.startsWith('/diagon-alley')` condition to include `pathname ===
'/ollivanders'` — reusing the mechanism already proven for this exact
problem rather than a new one-off tweak.

### Atlas registers itself with PLAN-22's offline-mode registry

By the time Atlas is implemented (gated on PLAN-22), the offline-mode
module already exists, and Atlas is exactly the pure-client-compute editor
that registry's `new-module` skill addendum was built to catch. Registering
it is Atlas's own task, not a retroactive edit to PLAN-22's shipped plan
file: add `atlas` to `server/src/modules/offline-mode/module.ts`'s target
registry and to `client/src/app/offlineWarmLoad.ts`'s loader map. First
real exercise of the standing-knowledge checkpoint PLAN-22 created.

## Tasks

- [ ] **Spike first**: craft an XML entity-expansion document, feed it
      through `DOMParser` in a real browser, settle the guard question
      before the parser depends on the answer
- [ ] Dep: `@codemirror/lang-xml` (client, `^6.x` band)
- [ ] `core/xml/index.ts`: `analyzeXml`/`validateXml`/`formatXml`/
      `minifyXml` (pure DOM-based parse/validate/pretty-print/minify,
      entity-expansion guard from the spike)
- [ ] `core/xml/plist.ts`: plist detection (`<plist>` root), typed walk
      producing `PlistNode` (preserving `integer` vs `real`, `string` vs
      `data`; each node carries its source offset for click-to-jump and
      surgical edits), `bplist00` magic-byte sniff for the binary-plist
      rejection message
- [ ] `core/xml/advisories.ts`: duplicate `<key>`, malformed `<date>`,
      invalid base64 `<data>`
- [ ] `core/ui/JsonEditor.tsx`: `'xml'` added to `EditorMode`, new
      `xmlModeExtensions()`, `xml` added to `closeBracketsMode`/
      `foldMode` gates; new imperative `replaceRange(from, to, text)` on
      `JsonEditorHandle` for table-originated transactions
- [ ] **Preparatory commit, alone and green first**: extract
      `core/ui/useSplitPanel` (ratio state, divider drag, breakpoint
      function) out of `EddaPage.tsx`'s inline implementation, Edda
      re-verified unchanged
- [ ] `core/ui/PlistTable.tsx` (new, editable — not a `TreeView`
      extension): header row + shaded root row (disclosure triangle,
      disabled type, item count, "+") + indented leaf rows, matching the
      reference screenshot; stepper-chevron control on Type/Value; value
      editor swaps by type (text/number, **"YES"/"NO" text for Boolean**,
      date picker, byte-count-plus-import for `<data>`, item count for
      containers); editable key text for dict entries; per-row add/delete;
      pointer-based drag-to-reorder (`pointerdown`/`pointermove`/
      `pointerup`, `insertBefore`); value edits commit on blur/Enter as
      surgical spans, type/add/remove/reorder as
      DOM-replace-then-serialize-affected-span; click-to-jump on row
      key/type
- [ ] New dict/array entries seed a sensible default (String/empty value,
      key auto-named "New item"/"New item 1"/… on collision; array entries
      unkeyed)
- [ ] `AtlasPage.tsx`: drag-and-drop file import (`.xml`/`.plist`), the
      `bplist00` rejection message, minimal valid plist skeleton as the
      new-document default
- [ ] Server `atlas` module (both profiles): `atlas_docs` table + migration
      (`db-migration` skill), repository, usecases (Save/Update/Get/List/
      Delete — `checkContent()` enforces the byte cap only, **never parses
      XML server-side**), routes incl. the public raw endpoint, bus → SSE
      (`atlas.saved`/`atlas.deleted`), audit
- [ ] `atlas` → `RESERVED_ROOTS` (`server/src/core/reserved-roots.ts`) and
      `reserved-roots.test.ts`, same change
- [ ] `ATLAS_MAX_DOC_KB` in the config schema + `.env.example`
- [ ] Client `features/atlas/`: `AtlasPage.tsx` — code pane (always) +
      table pane (plist only) via `useSplitPanel`, toolbar (Format,
      Minify, Copy, Undo/Redo, font control, save/clear), advisories, no
      multi-document tabs; `draft.ts`; `core/atlas.ts` API client
- [ ] Library: register `atlas` in `core/library/registry.tsx` — one array
      element; fixed Pensieve-badge `tone` picked after checking the
      current registry's actual values
- [ ] Routes `/atlas`, `/atlas/:slug`; legacy redirects; Ollivanders 7th
      `TOOLS` entry, appended + new icon
- [ ] `App.tsx:231`: extend `shell-main--wide` to `/ollivanders`
- [ ] Register `atlas` in PLAN-22's offline-mode registry — both
      `server/src/modules/offline-mode/module.ts` and
      `client/src/app/offlineWarmLoad.ts`
- [ ] Failure paths logged per `rules/coding.md`
- [ ] Docs sync (`architecture.md` registry + data flow,
      `project-structure.md`, `decisions.md`, `progress.md`,
      `plans/README.md`) + archive this file in this PR
- [ ] *Stretch, not core scope*: a convert handoff to Runestone (plist →
      JSON), the same shape as Groot's YAML→JSON convert button

## Acceptance criteria

1. A hand-authored `.xml` document (non-plist) opens, formats, validates,
   folds — no table appears for it.
2. A real Xcode-authored `Info.plist` opens with the table visible,
   correct declared type per row, correct expand/collapse for nested
   dicts/arrays.
3. Editing a String value's text updates the code pane with **only that
   value's span changed** (diff shows nothing else touched). Changing that
   row's type to Number converts sensibly and rewrites only that element's
   tags. Add/delete work correctly on exactly the target subtree. Every
   edit is undoable via the same Undo control the code pane uses, and
   editing the code pane directly updates the table back.
4. The crafted entity-expansion document either parses safely under the
   spike's guard or is refused with a clear message — never hangs/crashes.
5. Save/load-by-slug/delete/the public raw endpoint (content-type, CORS,
   `?download=1`, 301 on stale-but-valid slug) all work, mirroring Groot.
6. Pensieve lists Atlas documents with no page change beyond the registry
   entry; `POST /api/portkey {slug:"atlas"}` is 422.
7. Duplicate `<key>`, malformed `<date>`, invalid base64 `<data>` each
   produce their advisory, none blocking the save.
8. Responsive 375/768/1280, both themes, no horizontal overflow; below
   768px the split collapses to stacked/single exactly as Edda's does.
9. Code and table visible **simultaneously** in a resizable split
   ≥1024px, both independently scrollable, divider clamped 30–70% and
   persisted the same way as Edda's.
10. Format and Minify both visibly change the buffer from the toolbar.
11. Ollivanders shows all 7 cards with no vertical scroll at 1280×800;
    Atlas's card colour is visibly distinct from all six others.
12. With PLAN-22's offline-mode toggle enabled on Ollivanders,
    disconnecting the network still lets Atlas's code/table panes work.
13. Find (⌘F), find-next, and replace all work in Atlas's code pane,
    identically to Runestone/Groot.
14. Dragging a real `.plist` opens it; a binary (`bplist00`) plist shows
    the specific "convert with plutil" message; a new document starts from
    the valid minimal skeleton.
15. Clicking a row's key/type jumps the code pane to that node's source
    without entering edit mode on that row.
16. A rename that produces a duplicate key surfaces the existing advisory,
    never a blocking dialog.
17. Dragging a row to a new position within a dict or array reorders it;
    every other node's content stays byte-identical; the reorder is
    undoable.
18. Side by side with the reference screenshot: header row, shaded root
    row with disclosure triangle and item count, indented leaf rows, the
    stepper control on Type and Value, Boolean rows reading literal
    "YES"/"NO" — all present and matching.

## Tests

- [ ] Unit (`core/xml`): entity-expansion corpus (from the spike);
      malformed-XML corpus; plist type-preservation round-trip
- [ ] Unit (`core/xml/advisories`): the three advisory cases, each pinned
- [ ] Component (`PlistTable`): nested dicts/arrays render and expand/
      collapse correctly; a value edit is a surgical span-only change
      (asserted against surrounding text, not just the parsed result); a
      type change converts sensibly per source/target pair; add/delete
      touch exactly the target subtree; a rename producing a duplicate key
      surfaces the advisory, never blocks; every table-originated edit is
      undoable through the same handle the code pane's Undo button calls;
      a non-plist document never shows the table; row drag-to-reorder
      within both a dict and an array produces the correct order and
      touches nothing else
- [ ] Component/unit (`useSplitPanel`): ratio clamp, breakpoint switching,
      persistence — reused identically by Edda and Atlas
- [ ] Server: usecase units with a mocked repo; integration for CRUD, 301
      stale slug, 413, the public endpoint's content-type + CORS +
      `?download=1`; reserved-roots guard; kill test
- [ ] Live-verify (`live-verify` skill): a real `Info.plist`-shaped
      document end to end on the built server, the Pensieve updating over
      SSE on a second device, the raw endpoint fetched with curl, both DB
      paths integrity-checked, zero console errors
- [ ] Manual: a real phone on the LAN — the code editor and the table view
      at phone width

## On completion

This PR's paperwork: the docs sync in Tasks, plus archiving this file to
`.agent/plans/completed/` — the established one-PR-closes-its-own-paperwork
rule.
