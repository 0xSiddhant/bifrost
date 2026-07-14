# PLAN-07 — Runestone (JSON viewer / editor / library)

## Goal

A themed JSON tool in two parts. **Part A — the editor:** validate, color-code, format, and explore JSON on any device, with relic-generated titles. **Part B — persistence:** save documents ("runestones") to SQLite, browse a filterable library, open by slug URL, rename/delete. One plan file, one module (`runestone`), implemented **after PLAN-06 in normal numeric order**, as two PRs.

## Execution order

- Standard gate: starts only after PLAN-06 is merged. By then PLAN-04 (theme schema with `syntax` token group) and PLAN-06 (author identity via presence) are both in place, so nothing in this plan is blocked or provisional.
- **Part A** (editor) first: branch `feat/plan-07a-runestone-editor`, PR into `develop`.
- **Part B** (library) second: branch `feat/plan-07b-runestone-library`, PR into `develop`. May begin immediately after Part A merges.
- Part A must not create throwaway work for Part B: components and services are built shared from day one (see decisions).

## Scope

**In (Part A):** `runestone` module skeleton + editor page, CodeMirror 6 editor, dual code⇄tree view, full validation with all-errors reporting, syntax color tokens, relic-name title generator (shared core service), toolbar (format, minify, sort keys, copy, clear, fold/unfold, unescape-embedded-JSON, error nav), JSON-path click-to-copy, import/export, stats bar, localStorage draft survival, doc-size cap.
**In (Part B):** save/update/delete, library listing with filters, slug URLs, creative 404, rename rules, author from presence.
**Out:** JSON diff (PLAN-08 — but shares this plan's components), JSONPath querying, JSON→TS conversion (backlog), collaborative editing.

## Decisions & reasoning

- **Module id `runestone`, route `/runestone`** — runes = encoded symbols carved to be read later. Registered in both `local` and `cloud` manifests (Part A is fully client-capable; Part B's cloud story rides the existing repository-interface policy).
- **Editor: CodeMirror 6** (`@codemirror/lang-json`). Chosen over Monaco (2–3 MB, poor touch) and hand-rolled textarea+overlay (breaks on cursor sync/folding). CM6 is ~150 KB modular, best-in-class mobile editing, CSS-based theming that maps directly onto our tokens, and `@codemirror/merge` exists for PLAN-08's diff — same engine, two panes.
- **Reusable `<JsonEditor>` component is the deliverable, not a page.** Props: value, onChange, readOnly, height. Owns CM setup, validation wiring, toolbar slots. PLAN-08 mounts two of these; Part B mounts one. Page-welded code is forbidden.
- **Validation: `jsonc-parser`** (VS Code's own error-tolerant parser) layered over CM's linter — returns **all** errors with exact offsets (not just the first, unlike `JSON.parse`), and highlighting keeps working while the document is broken. Errors surface as squiggles + gutter markers + a status bar list with click-to-jump.
- **Syntax colors are theme tokens:** `--syn-key`, `--syn-string`, `--syn-number`, `--syn-bool`, `--syn-null`, `--syn-punct` added to `tokens.css` with Aurora + Daybreak values. **PLAN-04 amendment (already applied):** theme JSON schema gains an optional `syntax` group; themes omitting it get defaults derived from `--accent`/`--text` — no existing theme breaks.
- **`sortKeysDeep` ships as a shared pure util in `client/src/core/json/`** (alongside `formatJson`, `minifyJson`, `unescapeEmbedded`, `jsonStats`, `pathAt`) — explicitly because **PLAN-08's diff checker needs sort-keys too** (sort both sides before diffing to kill ordering noise). Pure functions, unit-tested once, imported twice.
- **Relic-name generator = shared core service** (`core/relics`, server + mirrored client util): curated bank across Norse / Potter / MCU with categories *person, object/relic, spell, weapon* (Loki, Mjölnir, Gungnir, Hofund, Brísingamen, Pensieve, Deluminator, Portkey, Expelliarmus, Tesseract, Aether, Stormbreaker…), pattern `<flavor-adjective> <Name>` ("Gleaming Gungnir"), collision-safe via short suffix. Used for page titles now, default file/document names in Part B, and available to any future module.
- **Tree view is read-only; editing happens in code mode.** Collapsible nodes, type badges, array/object item counts; tapping a key copies its JSON path (`data.items[3].price`) with a copied-toast. Phones default to tree view for viewing comfort.
- **Draft survival via localStorage** (allowed as non-critical convenience per coding rules): buffer auto-cached (debounced), "Restore draft?" toast on return, dismiss clears. Matters because real saving is Part B.
- **Doc-size cap:** `RUNESTONE_MAX_DOC_KB=2048` in `.env` — beyond ~2 MB, browser highlighting janks; also the storage guard for Part B.
- **Slug format (Part B): `/runestone/<kebab-name>-<6char-id>`** — the id anchors the URL, the name part is cosmetic, so **renames never break shared links** (old-name URLs with a matching id 301-redirect to the current slug).
- **Rename rules (owner requirement):** name is editable **only on the editor page** — inline on the title, before first save and after. The library never renames; it only opens/deletes.
- **Author (Part B):** presence deviceId → friendly device name (PLAN-06); fallback to UA label for unnamed devices. No accounts.
- **Creative 404 (Part B):** themed "This runestone was never carved / has crumbled" page offering two actions: *Carve it now* (opens editor pre-titled with the slug's name part) and *Back to the library*.

## API contracts (Part B — all under `/api/runestone`)

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/runestone` | Library listing | `[{ id, name, slug, author, createdAt, modifiedAt, sizeBytes }]`; query params: `q` (name/author search), `author`, `sort` (name\|created\|modified\|size), `order`, pagination |
| `POST /api/runestone` | Save new | `{ name?, content }` — name defaults to relic generator; 413 over cap; 422 invalid JSON |
| `GET /api/runestone/:slug` | Fetch one | 404 → client shows creative 404; stale-name slug with valid id → 301 to current slug |
| `PUT /api/runestone/:id` | Update content and/or name | Rename regenerates slug (old id-links keep working); bumps modifiedAt |
| `DELETE /api/runestone/:id` | Delete | Library confirm dialog |
| SSE | `runestone.saved` / `runestone.deleted` | Library live-updates; audit-log subscribes |

**DB (Drizzle, owned by module):** `runestones(id TEXT pk, name TEXT, slug TEXT unique, content TEXT, author_device_id TEXT, size_bytes INT, created_at, modified_at)`.

## Task checklist

**Part A — editor (first PR, after PLAN-06 merges)**
- [ ] Module skeleton (`modules/runestone/` server-side registers route/capability only; feature UI in `client/src/features/runestone/`)
- [ ] `core/relics` name service + client mirror; unit-tested bank/pattern/collision logic
- [ ] Consume syntax tokens (`--syn-*`) shipped by PLAN-04 — bind CM highlight styles to them; verify Aurora + Daybreak values render distinctly
- [ ] `<JsonEditor>`: CM6 setup, lang-json, folding, theme binding to tokens, mobile ergonomics pass
- [ ] Validation pipeline: jsonc-parser all-errors → squiggles, gutter, status bar with click-to-jump, "Valid JSON ✓" state
- [ ] `client/src/core/json/` utils: `formatJson`, `minifyJson`, `sortKeysDeep` (recursive A→Z — **shared with PLAN-08**), `unescapeEmbedded`, `jsonStats` (bytes/nodes/depth), `pathAt`
- [ ] Toolbar: format, minify, sort keys, copy, clear (confirm), fold/unfold all, unescape-embedded, error prev/next
- [ ] Tree view: collapsible, type badges, counts, tap-key → copy JSON path; code⇄tree toggle, tree default on <768px
- [ ] Title: relic-generated on load, inline-editable, feeds export filename
- [ ] Import (drag/drop or picker for `.json`) + export (`<name>.json` download)
- [ ] Stats bar; size-cap guard with friendly over-limit state; localStorage draft cache + restore toast
- [ ] Nav entry via capabilities

**Part B — library (second PR, after Part A merges)**
- [ ] Drizzle schema + migration; repository interface + SQLite impl
- [ ] Usecases: save/update/rename+reslug/delete/list-with-filters; slug service (kebab + id, redirect resolution)
- [ ] Routes per contract; events on bus; audit-log picks them up automatically
- [ ] Editor page gains Save/Saved state (dirty tracking), author attach from presence
- [ ] Library page: table/cards responsive, search + author filter + sort, open/delete, live SSE refresh
- [ ] Creative 404 with *Carve it now* + *Back to library*
- [ ] Draft-cache handoff: saving clears the localStorage draft

## Acceptance criteria

**Part A**
1. Pasting broken JSON shows *every* error with positions; fixing them flips to "Valid ✓" without reload; editing stays smooth on a 1.5 MB doc on iPhone.
2. Keys/strings/numbers/bools/null are visibly distinct in both Aurora and Daybreak; switching theme recolors the open editor instantly (tokens only).
3. Every toolbar action round-trips correctly (`sortKeysDeep` is idempotent and stable — property-tested); tree path-copy yields a path that resolves in code.
4. Refresh mid-edit on a phone → restore-draft toast recovers the exact buffer.
5. Title regenerates as a plausible relic name on each fresh load; export filename matches title.

**Part B**
6. Save → appears in library with correct author/size/dates; open-by-slug works from another device; rename on editor updates slug while the old id-link still resolves.
7. Filters/search/sort behave with 50+ seeded docs; delete removes with confirm and live-updates other open libraries.
8. Unknown slug → creative 404; *Carve it now* opens the editor titled from the slug.
9. Kill test: SIGINT during save burst → restart → no torn rows, drafts intact.

## Test checklist

- [ ] Unit: all `core/json` utils (incl. sortKeysDeep property tests), relic generator, slug service, validation adapter corpus (nested errors, trailing commas, NaN, BOM)
- [ ] Integration (B): CRUD + filter queries + 301 slug redirect + 413/422 paths via inject
- [ ] Manual: iPhone Safari tree/edit pass, Android Chrome, desktop; theme-switch while editing
