# PLAN-19 — Groot (YAML editor, viewer & library)

## Goal

The third structured-text workspace on Ollivanders, beside Runestone (JSON) and Edda (Markdown): a YAML editor with syntax highlighting, folding, comment-preserving formatting, live validation, a tree view, YAML ⇄ JSON conversion, and its own saved-document library in the Pensieve — plus a public raw endpoint so a saved document is a stable data URL, the Runestone/Edda pattern.

## Name

**Groot** — owner's pick. A literal walking tree: one trunk, many branches, folded and unfolded. One syllable, impossible to mispronounce or misspell, and short in a URL.

There is a real joke underneath the obvious one. "I am Groot" is three fixed words that mean something different every time depending on context and inflection — which is **exactly YAML's defining hazard**: the same bare characters mean different things depending on where they sit and who is reading. `no` is a string here and `false` in a YAML 1.1 consumer; `1.10` is the number 1.1; `y` is a string or a boolean depending on the schema. The advisory rail in this plan exists for precisely that class of problem, so the name names the feature's hardest part.

Register note: the MCU is already one of the app's established worlds (the screensaver quote bank draws on HP / MCU / Ghibli / Norse / Greek), and character names are already used for features — Loki, Accio, Portkey, Nimbus, Pensieve. This is the first MCU-named *feature*, and the most playful name on the Ollivanders shelf; that is a deliberate owner choice, not an oversight.

Card copy: eyebrow `groot · one trunk, many branches`, `go: 'branch by branch'`.

**Every identifier derives from the name:** module `groot`, table `groot_docs`, events `groot.saved|deleted`, routes `/groot`, `/api/groot`, `/groot/api/:slug`, reserved root `groot`, env `GROOT_MAX_DOC_KB`, `client/src/features/groot/`, `client/src/core/groot.ts`. The pure YAML utilities stay format-named at `client/src/core/yaml/` — they are about the format, not the tool, and Variant will share them.

## Gate

PLAN-18 merged. **Single PR** — `feat/plan-19-groot`.

> **⚠️ Check PLAN-21 first.** PLAN-21 (Pensieve, the unified library shell) **deletes** the per-tool library pages and replaces them with one registry. If it has already shipped, this plan's `GrootLibraryPage` task collapses to **one registry entry** in `core/library/` plus a `/groot/pensieve` redirect — do not build a third library page. If it has not, building one here means it is deleted in PLAN-21's PR; the recommended execution order is **18 → 21 → 19 → 20** for exactly this reason.

The plans are independent (different hubs, no shared files beyond `JsonEditor`), so the owner may reorder them; the gate is the standing "implement in order" rule, not a real dependency. Single PR follows the PLAN-11 (Edda) precedent, which shipped editor + preview + library + public routes in one — every pattern this plan needs already exists. If it grows past that, split at the library boundary.

## Decisions & reasoning

### Parsing

- **`yaml` (eemeli) v2** is the parser, client-side only. It is the only mainstream choice that gives all four things this plan needs: a **comment-preserving document model** (`parseDocument()` → `.toString()`), **multi-document** support (`parseAllDocuments`), **errors with `linePos`/offsets** for the lint gutter, and **YAML 1.2 core schema by default**. `js-yaml` loses every comment on round-trip, which for config files is silent data loss.
- **YAML 1.2 by default matters, and is worth stating.** Under YAML 1.1 (Ruby, older Python, some CI runners) unquoted `no`, `off`, `yes`, `on` parse as booleans — the "Norway problem", where the country code `NO` becomes `false`. `yaml` v2 reads them as strings. That is correct *here* and wrong on the reader's machine, so the tool **advises** on these values rather than silently normalising them (see Advisories).

### The server does not parse YAML

- **The server stores text and enforces the byte cap only** — no YAML parsing server-side. Two reasons: YAML alias expansion is a **billion-laughs amplifier** (a 3 KB document can expand to gigabytes, so the size cap does *not* bound the parse), and there is nothing to gain — the client refuses to save a document it cannot parse, and a stored document only ever needs to be handed back verbatim.
- This follows **Edda**, not Runestone. Runestone parses server-side because `/runestone/api/:slug` promises `application/json`; `/groot/api/:slug` promises "the bytes that were saved", which is the same promise Edda's markdown endpoint makes.
- Consequence, accepted: a client POSTing directly could store syntactically invalid YAML, and the raw endpoint would serve it back. That is exactly what Edda does with malformed markdown.
- The **client** sets `maxAliasCount` on every parse so a YAML bomb pasted into the editor cannot hang the tab either.

### Folding — verified, not assumed

The requirement was that folding actually work. `@codemirror/lang-yaml@6.1.3` was unpacked and read rather than trusted:

```
foldNodeProp.add({
  "FlowMapping FlowSequence": foldInside,
  "Item Pair BlockLiteral": (node, state) => ({ from: state.doc.lineAt(node.from).to, to: node.to })
})
```

- **Block YAML folds** — `Pair` (a `key:` and everything nested under it), `Item` (a `-` sequence entry) and `BlockLiteral` (`|` / `>` blocks) all fold from the end of their first line to their end. **Flow YAML folds** via `FlowMapping`/`FlowSequence`. Both styles are covered.
- **No custom `foldService` is needed.** This is written down deliberately: Loki needed one because lang-javascript has a real gap (`ObjectPattern`), and the next person should not build a speculative YAML equivalent. A single-line pair (`name: foo`) yields `from >= to` and correctly offers no arrow.
- **The actual work is enabling it.** `JsonEditor` currently gates `foldGutter()` and `foldKeymap` behind `foldMode = jsonOnly || javascriptMode`; YAML must join that set, and `foldAll`/`unfoldAll` on `JsonEditorHandle` then work for free.

### Tabs

`indentNodeProp` from `lang-yaml` gives real indentation support, but **a tab character in YAML indentation is a hard syntax error**. `JsonEditor` binds `indentWithTab` globally; CM's `insertTab` inserts the `indentUnit` facet, so YAML mode must set **`indentUnit.of('  ')`** and it is then impossible to type a structural tab. This is an acceptance criterion, not a footnote — it is the single easiest way for this editor to produce a file that will not parse.

### `JsonEditor` gets a `mode` prop

The component already carries `plain`, `markdown`, `javascript` booleans resolved by a nested ternary; YAML would be a fourth boolean and a fifth branch, with the invalid combinations ("mutually exclusive with…") enforced only by a doc comment. Replace them with **`mode: 'json' | 'markdown' | 'javascript' | 'plain' | 'yaml'`**, defaulting to `'json'`.

- Touches four existing call sites (Runestone, Variant ×2 panes, Edda, Loki) and changes no behaviour.
- **Ships as its own commit, before any YAML code** — `rules/coding.md` git rules forbid mixing a refactor with a feature in one commit, and this is exactly that case. The refactor commit must be green on its own.

### `core/yaml/`, not `features/groot/`

Mirrors `core/json/` and `core/markdown/`, for the same reason: Variant will want a YAML mode (see Stretch), and features may never import features. Pure functions only — parse, validate, format, convert, advise. It is named for the **format**, not the tool, so a future second YAML consumer reads naturally.

### Conversion is the tool's second job

YAML ⇄ JSON both directions, in-page. **Handoff to Runestone and Variant reuses the existing boundary-legal bridges** — Loki→Variant already established `core/variantSeed` (a `sessionStorage` hop) for precisely this, and Runestone is reachable by navigating with a seed. No feature imports another.

### Storage

- Table **`groot_docs`** (migration `0011`, additive). The `runestones`/`eddas` naming does not generalise — Groot is the tree, not the document — so this takes the **`accio_links` precedent**: module name + generic noun. Columns mirror `eddas` exactly (`id`, `name`, `slug`, `content`, `author_device_id`, `size_bytes`, `created_at`, `modified_at`).
- Same 6-char id + `<kebab-name>-<id>` slug scheme, same 301-on-stale-slug behaviour. The slug helpers are **copied into the module**, as `edda/slug.ts` copied them from `runestone/slug.ts` — modules may not import each other, and this duplication is already the established shape.
- `groot.saved` / `groot.deleted` on the bus → SSE (live library) + audit-log, matching runestone/edda.
- **Both profiles**, like runestone/variant/edda.

### Advisories, not errors

YAML's traps are mostly *valid* documents that mean something else than they look like — the thing the name is a joke about. The editor shows an **advisory rail** (warnings, never blocking, never auto-fixed):

| Advisory | Why |
|---|---|
| Unquoted `no`/`yes`/`on`/`off`/`y`/`n` | Reads as a string here (YAML 1.2) and as a boolean in any YAML 1.1 consumer — the Norway problem |
| Duplicate key in a mapping | Last one wins silently in most parsers; almost always a mistake |
| Tab character in indentation | Hard error in the spec; flagged with the line so it is findable |
| Unquoted version-like value (`version: 1.10`) | Parses as the number 1.1 |
| Integer beyond IEEE-754 safe range | Loses precision on the round trip |
| Alias/anchor use | Informational — names the anchors so an expanded tree view is not surprising |

## Editor parity checklist

Everything Runestone's editor does, this must do. The requirement was explicit, so it is a table, not a sentence.

| Capability | How it is met |
|---|---|
| Syntax highlighting | New `yamlHighlight` `HighlightStyle` over the existing `--syn-*` theme tokens — no hex in the component |
| Folding + fold gutter | `lang-yaml`'s `foldNodeProp` (verified above); YAML added to `foldMode` |
| Fold all / Unfold all | Existing `JsonEditorHandle.foldAll/unfoldAll`, wired to the rail |
| Format | `parseDocument` + `.toString({ indent, lineWidth: 0 })` — **comments survive** |
| Compact / expand | Flow style (`{a: 1}`) ⇄ block style — YAML's analogue of minify/beautify |
| Validation | `linter()` + `lintGutter()` fed by `validateYaml`, every error with a line, the JSON mode's surface |
| Find + "N of M" | Inherited from `JsonEditor` unchanged |
| Undo / redo | Inherited |
| Bracket matching / auto-close | On, for flow style |
| Tree view | Existing `core/ui/TreeView` over the parsed value — copy path, copy value, bulk collapse all inherited |
| Multi-document | `parseAllDocuments`; a doc switcher when `---` separators are present |
| Draft persistence | `features/groot/draft.ts`, the Runestone/Edda precedent |
| Panel font A−/A+ | Existing shared control |
| Library (Pensieve) | `/groot/pensieve`, live over SSE |

## API contracts

| Method & path | Purpose |
|---|---|
| `GET /api/groot` | List summaries; `q`, `authorDeviceId`, `sort`, `order`, `limit`, `offset` — the runestone filter shape |
| `POST /api/groot` | `{ name, content }` → 201 `{ id, slug }`; 413 over `GROOT_MAX_DOC_KB` |
| `GET /api/groot/:slug` | One document; stale-name slug with a valid id → **301** to the canonical slug |
| `PUT /api/groot/:id` | Update name/content; a rename regenerates the slug |
| `DELETE /api/groot/:id` | Remove |
| `GET /groot/api/:slug` | **Public raw endpoint, outside `/api/`** (wins over the SPA fallback): the stored text as `application/yaml; charset=utf-8` (RFC 9512), `access-control-allow-origin: *`, stale slug 301s, `?download=1` → attachment. Read-only |
| SSE `groot.saved` / `groot.deleted` | Live library; audit-log subscribes |

Reserved first segments in slug resolution: `api`, `pensieve`, `library`.

## Tasks

- [ ] **Commit 1, alone:** `JsonEditor` boolean modes → a single `mode` prop; update Runestone, Variant (both panes), Edda, Loki; no behaviour change
- [ ] Deps: `yaml@^2.9`, `@codemirror/lang-yaml@^6.1` (client)
- [ ] `core/yaml/` — `validateYaml` (issues with offset/length/message), `formatYaml` (comment-preserving), `toFlow`/`toBlock`, `yamlToJson`/`jsonToYaml`, `parseDocuments`, `advisories`; `maxAliasCount` on every parse
- [ ] `JsonEditor` YAML mode: `yaml()`, `yamlHighlight` over `--syn-*`, `foldGutter()` + `foldKeymap` + `indentUnit.of('  ')`, `linter`/`lintGutter` on `validateYaml`
- [ ] Server `groot` module (both profiles): `groot_docs` + migration `0011`, repository, 5 usecases, routes incl. the public raw endpoint, bus → SSE, audit
- [ ] `groot` → `RESERVED_ROOTS` **and** the `reserved-roots.test.ts` assertion list (same change, per `rules/coding.md`)
- [ ] `GROOT_MAX_DOC_KB` in the config schema + `.env.example`
- [ ] Client `features/groot/`: `GrootPage` (editor · tree · advisories · convert), `draft.ts`, `core/groot.ts` API client
- [ ] **Library — depends on PLAN-21 (see Gate).** If PLAN-21 has shipped: register `groot` as a kind in `core/library/` and redirect `/groot/pensieve` → `/pensieve?type=groot`, *no page*. If not: build `GrootLibraryPage` as a third copy, knowing PLAN-21 deletes it
- [ ] Routes `/groot`, `/groot/:slug`; `/groot/library` → `<Navigate replace>`; Ollivanders 5th card (positional tone) + a new `TreeIcon`
- [ ] Convert handoffs: → Runestone (as JSON), → Variant (via `core/variantSeed`)
- [ ] Failure paths logged per `rules/coding.md` — a plan is not done until they are
- [ ] Docs sync (`architecture.md` registry + data flow, `project-structure.md`, `decisions.md`, `progress.md`, `plans/README.md`) + archive this file **in this PR**
- [ ] *Stretch:* Variant gains a YAML mode — parse both sides through `core/yaml`, reuse the existing structural diff walker

## Acceptance criteria

1. A 200-line Kubernetes manifest highlights, folds and unfolds correctly: clicking the arrow on `spec:` collapses everything nested under it; `- name:` list items fold individually; a `|` block literal folds; a single-line `name: foo` offers **no** arrow. Fold all / Unfold all cover the whole document.
2. **Formatting a document with comments preserves every comment**, in position — head, key-level and trailing alike. This is the criterion that fails a naive `parse` + `stringify` implementation.
3. Format re-indents inconsistent indentation to the chosen unit without changing a single value; round-tripping an already-formatted document is a no-op.
4. Pressing **Tab** anywhere inserts spaces — the document never gains a literal tab character.
5. A syntax error shows in the lint gutter on the correct line, with a message naming the problem; fixing it clears the marker.
6. Every advisory in the table fires on a document that triggers it, is **non-blocking**, and changes no bytes: `country: no` is flagged and still saves as written.
7. A multi-document file (`---`-separated) parses, the tree view exposes each document, and saving/reloading returns all documents byte-identical.
8. Anchors and aliases resolve in the tree view with the alias marked as such; a **billion-laughs document does not hang the tab** (bounded by `maxAliasCount`, asserted in a unit test).
9. YAML → JSON → YAML round-trips values unchanged (comments are lost through JSON by nature — the UI says so before converting).
10. Save → the document appears in the Pensieve **on another open device within a heartbeat**, and audit-log records it.
11. `GET /groot/api/<slug>` returns the exact stored bytes as `application/yaml; charset=utf-8` with `access-control-allow-origin: *`; a renamed document's old slug **301s** to the new one; `?download=1` attaches.
12. Saving over `GROOT_MAX_DOC_KB` → 413 with the cap in the message; the editor says so before the request.
13. A `/go/groot` Portkey slug is refused (422) — the reserved-roots entry is real, proven through the API, not by reading the list.
14. Kill test: SIGKILL mid-save leaves no torn row — a document either exists fully or not at all; `integrity_check ok` on both an upgraded and a fresh DB.
15. The `mode` refactor commit alone is green (lint, typecheck, all tests, build) and Runestone/Variant/Edda/Loki behave identically before and after.
16. Editor and library at 375 / 768 / 1280 with no horizontal overflow; the tree and editor are usable on a phone.

## Tests

- [ ] Unit (`core/yaml`): validation corpus (tabs, bad indent, unclosed flow, duplicate keys, `%YAML` directives), comment-preserving format round-trips, flow⇄block, YAML⇄JSON incl. multi-doc and anchors, every advisory (positive **and** negative case each), `maxAliasCount` bomb guard
- [ ] Unit: slug helpers (the runestone/edda corpus), reserved-segment resolution
- [ ] Component: YAML mode folds `Pair`/`Item`/`BlockLiteral` and not a single-line pair — asserted against the **real editor extension list** (the `javascriptModeExtensions` export precedent), and Tab inserts spaces
- [ ] Server: usecase units with a mocked repo; integration for CRUD, 301 stale slug, 413, the public endpoint's content-type + CORS + `?download=1`, route precedence over the SPA fallback; `reserved-roots` guard; **kill test**
- [ ] Live-verify (`live-verify` skill): a real multi-document k8s manifest folded/formatted/saved/reloaded on the built server, comments intact after format, the Pensieve updating on a second device over SSE, the raw endpoint fetched with `curl`, both DB paths `integrity_check`ed, zero console errors
- [ ] Manual: a real phone on the LAN — editor, folding gutter, and tree view at phone width
