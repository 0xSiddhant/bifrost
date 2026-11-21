# PLAN-42 — Runestone JSONC: comments as a first-class format

## Goal

Extend Runestone from strict JSON to an explicit JSON/JSONC editor mode. JSONC accepts line and block comments plus trailing commas, and nothing else beyond JSON. A format switch sits with the editor controls; JSON remains the default, imported `.jsonc` files select JSONC, and the choice survives scratch-draft restore, saving, reopening and Pensieve browsing. JSONC documents remain Runestones, with a visible format badge and a real format filter. Variant can compare JSONC structurally without treating comments as data, and the import/export, raw-data and cross-tool hand-off paths retain the format where it matters. Every in-place transformation must either preserve comments or be unavailable with a clear explanation; explicitly named non-mutating conversions may omit comments from their output without changing the source. Existing strict-JSON behavior remains unchanged.

## Gate

PLAN-41 merged. Single PR.

## Verified against the codebase, not assumed

- **The JSON core already uses `jsonc-parser`, but in strict mode.** `client/src/core/json/index.ts` sets `disallowComments: true` and `allowTrailingComma: false` for validation, tree parsing, stats and path ranges. Formatting uses parser edits; minification scans with trivia ignored (so it would drop comments); key sorting parses and stringifies values (so it would drop comments and normalize large numbers). The installed `jsonc-parser` 3.3.1 accepts comments and trailing commas when configured to do so, and its `format()` edits preserve comments, key order and number tokens.
- **The editor parser is a separate concern.** `client/src/core/ui/JsonEditor.tsx` uses `@codemirror/lang-json`'s `json()` parser and a strict custom linter. A probe of the installed parser marks comments and trailing commas as syntax errors; `parser.configure({ dialect: 'jsonc' })` does not change that. The JSONC mode must not ship with false syntax errors: implement or select a CodeMirror language mode that handles JSONC, and verify highlighting, linting, folding and bracket matching against valid and invalid examples before wiring it into Runestone and Variant.
- **Runestone has multiple strict-JSON paths today.** `client/src/features/runestone/RunestonePage.tsx` validates with `validateJson`, parses its Tree view with `JSON.parse`, and exposes Format, Minify, Sort keys, Unescape and Copy as JS. Its picker/drop/export accept only `.json`/`application/json`. `client/src/features/runestone/draft.ts` and `client/src/core/runestoneSeed.ts` store only title and text, so both need to carry the format.
- **The server validates and stores the format implicitly.** `server/src/modules/runestone/usecases/manage-runestones.ts` calls `JSON.parse` before save/update. `server/src/core/db/schema.ts`'s `runestones` table has content but no format; migrations currently end at `0013_drop_themes_disabled`. Runestone routes reject unknown body fields, and `GET /runestone/api/v1/:slug` returns raw text as `application/json`. The server workspace does not currently declare `jsonc-parser`; the client does.
- **Pensieve is one kind per tool, and pagination is server-backed.** `client/src/core/library/registry.tsx` adapts Runestone summaries into `LibraryItem`; `LibraryQuery` has no format field. The page merges per-kind paged streams, and each server total must match its filters. A JSON/JSONC filter therefore needs to reach Runestone's server query/count rather than filtering already-fetched rows in the browser. JSON and JSONC stay the same `runestone` kind.
- **Other hand-off paths are explicit.** `client/src/core/contentFormat/registry.tsx` detects content by text and seeds Runestone; it checks strict JSON before YAML. Filename-based selection belongs in Runestone's import handler, while content detection can identify JSONC only when comments or trailing commas make the text non-JSON. `client/src/features/variant/compare.ts` validates and parses both panes as strict JSON; Variant also imports files and loads saved Runestones. `client/src/features/variant/VariantPage.tsx` formats and sorts both panes with the same comment-losing JSON operations.
- **The existing raw-data contract is documented and tested.** The Runestone public URL serves byte-for-byte stored text with CORS and `application/json`; `client/src/core/library/curl.ts` builds the `Accept` header from one fixed `LibraryEntry.mimeType`. Both the response media type and Pensieve's copyable curl command must reflect a saved document's format.
- **The format guide teaches strict JSON.** `client/src/assets/guides/json.md` currently says comments and trailing commas are invalid and groups JSONC with JSON5. Update it to distinguish strict JSON from this app's supported JSONC subset.

## Scope

**In:**

- An accessible JSON/JSONC switch at the top of Runestone's editor controls. New documents default to JSON; loading/importing a `.jsonc` file selects JSONC. Switching modes changes validation and editor behavior only; it never rewrites the buffer.
- JSONC validation, Tree view parsing, editor syntax support and format/minify actions that preserve comments. Key sorting must keep each leading and same-line trailing comment with its original member, preserve raw value tokens, or be disabled in JSONC with a clear explanation. Keep Unescape unavailable in JSONC unless it can retain comments outside the unescaped value. Add a non-mutating **Copy as strict JSON** action for consumers that reject comments only if it can preserve raw value tokens without changing the source buffer.
- JSONC state in the scratch draft, seed hand-offs, saved Runestone metadata and Pensieve. Keep one Runestone kind, show each row's JSON or JSONC format, and filter by format without breaking server-side pagination, totals, search, author filtering or live refresh.
- `.jsonc` import/drop/export in Runestone and Variant; extension-aware content detection and Runestone hand-offs; JSONC-aware structural comparison in Variant (comments are not data and do not produce diff records).
- Server validation and persistence, a schema migration, API response/query updates, format-correct raw data media type and `Accept` header, OpenAPI regeneration, docs and regression/new tests.

**Out:**

- JSON5 features: unquoted keys, single-quoted strings, `NaN`, `Infinity`, `undefined`, or other non-JSON syntax.
- Changing JSON mode's strict validation, silently converting existing saved documents, or rewriting text when the mode changes.
- A separate JSONC tool/module/table or a separate Pensieve document kind.
- JSONC semantics in YAML, XML, Markdown, Brotli, or unrelated features. Brotli continues to treat the handed-off bytes as opaque text.

## Decisions & reasoning

### JSONC is a per-document mode, not a second tool

JSONC is the comment-and-trailing-comma subset chosen here, not the full JSON5 language. Strict JSON remains the default for new documents and continues to reject comments and trailing commas. Persist a `format: 'json' | 'jsonc'` value on each Runestone, include it in list and full-document responses, and default omitted format fields to `json` on create. Existing rows migrate to `json`. On update, an omitted format preserves the stored format; an explicit format change is validated against that mode. This keeps older clients' JSON requests compatible and makes the toggle itself dirty/saveable without coercing the user's text.

The toggle changes mode only. If a buffer containing comments is switched to JSON, the comments remain visible, JSON diagnostics appear, and saving is blocked until the user switches back or edits the text into strict JSON. There is no implicit comment stripping.

### Pensieve keeps one Runestone stream

JSON and JSONC share the same editor, saved-document API, events and delete behavior, so creating a new `LibraryKind` would duplicate a tool distinction as if it were a new tool. Add the format to Runestone's summary and `LibraryItem`; render a JSON/JSONC badge and a URL-backed format filter only when the Runestone kind is selected. Pass that filter to Runestone's paged API and apply it in the repository's shared `where` predicate and count. The other kinds ignore the optional filter. This preserves the pager's per-kind offsets and page totals.

### JSONC must be comment-safe end to end

Reuse `jsonc-parser` for validation, parsing, stats, paths and source-preserving edits. A new CodeMirror mode is required: the installed JSON grammar rejects valid JSONC, even when configured with a `jsonc` dialect. First test a maintained CM6 JSONC mode against the exact editor requirements; if none meets them, add a focused local mode backed by the existing JSONC scanner/parser. Do not retain the current strict grammar for JSONC or mark valid JSONC as syntactically broken.

Format keeps all comments and raw value tokens. Minify may remove whitespace but must keep comments and insert any separator/newline needed so a `//` comment cannot consume the next token. Sorting is enabled only if it keeps each leading and same-line trailing comment with its original member and preserves raw numeric/string tokens; if that association cannot be determined safely, disable it in JSONC and explain why. Tree view, Copy as JS and cursor paths operate on the parsed JSONC value while leaving the source text untouched. Unescape stays unavailable unless it preserves comments outside the unescaped value. Copy as strict JSON is an explicit, non-mutating conversion; it must remove comments/trailing commas without parse/stringify rounding or changing raw values. If that cannot be demonstrated, omit that action rather than ship a lossy conversion.

### Variant compares values, not comments

Variant's structured panes accept both strict JSON and JSONC. Its structural compare parses both using the chosen JSONC mode, so a comment-only change is not a data change; the original pane text, including comments, remains unchanged. Format preserves comments. Sort-both follows the same safe-or-disabled rule as Runestone. JSON Patch export operates on parsed values and remains a strict JSON Patch document. Text mode stays untouched.

### Format travels across existing boundaries

The Runestone API remains the owner of its saved documents; no feature imports another feature. The shared content-format registry detects strict JSON first, then JSONC before YAML, and seeds Runestone with the detected mode. Text that is strict JSON remains JSON there because content alone cannot identify a `.jsonc` filename; Runestone's filename-aware importer selects JSONC for any `.jsonc`, even when its contents happen to be strict JSON. Import and export use `.json`/`application/json` or `.jsonc`/`application/jsonc` respectively. The public raw endpoint keeps its existing path and CORS behavior, but sends the mode's media type; the OpenAPI response lists both and Pensieve's curl helper derives `Accept` from the row format.

### Preserve API and migration compatibility

Add a non-null `format` column defaulting to `json`, plus a generated migration after `0013`. Older saved rows therefore remain strict JSON; a fresh database and an upgraded database converge on the same schema. Keep `format` optional in create requests for existing clients. For updates, omission means "leave the current format unchanged"; the new UI sends the selected format. Update response schemas and the committed OpenAPI spec with the added field and query parameter. Server validation uses a direct server-workspace dependency on the same `jsonc-parser` release already used by the client; do not import client code into the server.

## API contracts

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/v1/runestone` | List Runestones | Add optional `format=json\|jsonc`; apply it to both legacy and paged results, including the total. Summaries include `format`. No format parameter preserves current behavior. |
| `POST /api/v1/runestone` | Save a Runestone | Optional `format`; absent means `json`. Validate against the selected format. Response includes `format`. |
| `GET /api/v1/runestone/:slug` | Read a Runestone | Response includes `format` and the original content bytes as text. |
| `PUT /api/v1/runestone/:id` | Rename, edit or change format | Optional `format`; omission preserves stored format. Validate content using the effective format. Response includes `format`. |
| `GET /runestone/api/v1/:slug` | Public raw-data URL | Keep path, redirect and CORS behavior. Send `application/json` for JSON and `application/jsonc` for JSONC; describe both response media types. |
| `DELETE /api/v1/runestone/:id` | Delete a Runestone | Unchanged. |

No new route is added.

## Task checklist

- [ ] **Shared parser and editor mode**
  - [ ] Extend `client/src/core/json/index.ts` with explicit strict-JSON and JSONC parsing/validation paths; retain existing strict defaults for current callers.
  - [ ] Add JSONC tests in `client/src/core/json/json.test.ts` for comments, trailing commas, malformed syntax, offsets, JSON5 exclusions, tree/path/stats, formatting and minification. Include comment-like text inside strings, both comment styles, and safe `//` minification boundaries.
  - [ ] Verify and implement a CodeMirror 6 JSONC syntax mode in `client/src/core/ui/JsonEditor.tsx`; keep `mode: 'json'` strict and add an explicit JSONC mode. Test valid JSONC has no false syntax/lint errors and invalid JSONC still has precise diagnostics.
  - [ ] Add and test a comment-safe key-sort implementation only if it preserves comments and raw tokens; otherwise expose the JSONC control as disabled with a reason.
- [ ] **Runestone UI and local workflows**
  - [ ] Update `client/src/features/runestone/RunestonePage.tsx` and `runestone.css` with an accessible JSON/JSONC switch in the top toolbar, selected-format status, mode-specific validation/Tree parsing and save/dirty semantics.
  - [ ] Persist format in `RunestoneDraft` and `RunestoneSeed`; restore the format alongside title/text and keep old cached drafts without a format defaulting to JSON.
  - [ ] Support `.jsonc` file pick/drop and format-correct export names/media types. Ensure an imported extension selects the mode; a mode switch never changes text.
  - [ ] Make Format and Minify preserve comments; gate Sort keys and Unescape according to the comment-safety rules above. Make Copy as JS parse JSONC without changing the source. Add the token-preserving, non-mutating Copy as strict JSON action only if its conversion passes the tests above.
  - [ ] Extend `client/src/features/runestone/RunestonePage.test.tsx` and focused draft/seed tests for default mode, toggle behavior, restore, imports/exports, saves and reloads.
- [ ] **Server persistence and API**
  - [ ] Add a `format` field to the Runestone schema, ports, repository, usecases, bus summary and route DTOs; ensure `format` is present in list and full-document results and SSE save summaries.
  - [ ] Add `jsonc-parser` as a direct server dependency at the client-used release; validate JSON/JSONC by explicit format while preserving the existing size cap and error behavior. Run `npm audit` and require zero findings.
  - [ ] Generate the migration after `0013` with existing rows defaulting to `json`; verify both upgraded and fresh databases.
  - [ ] Add and test the optional list format filter in the HTTP schema, usecase, repository `where`/`count`, and client API. Preserve legacy unpaged response shape and paging behavior apart from the new summary field.
  - [ ] Extend POST/PUT schemas and response schemas, make the raw endpoint format-aware, update its raw response media types, regenerate `server/openapi.json`, and pass API coverage/contract tests.
- [ ] **Pensieve, Variant and hand-offs**
  - [ ] Add `format` to `RunestoneSummary`/`LibraryItem`, derive the raw-data `Accept` media type per row, and show a JSON/JSONC badge in Pensieve.
  - [ ] Add a URL-backed Runestone format filter that reaches the server's paged query and count; preserve page reset, search/author/sort interaction, SSE refresh, legacy JSON links and all other library kinds.
  - [ ] Extend `client/src/core/contentFormat/registry.tsx` and its tests to recognize JSONC-only syntax before YAML and seed Runestone with the format; keep strict JSON detection unchanged.
  - [ ] Extend Variant's JSON helpers, `client/src/features/variant/VariantPage.tsx`, JSON file picker and saved-document loading for JSONC; preserve comments in buffers, ignore them in structural results, and keep exported patches strict JSON.
  - [ ] Update client core/library, Pensieve, Variant and hand-off unit/component tests; add end-to-end coverage for JSONC import → save → Pensieve filter/reopen → Variant compare → `.jsonc` export.
- [ ] **Documentation**
  - [ ] Update `client/src/assets/guides/json.md` to document strict JSON versus the supported JSONC subset, format switching, comment-safe operations, and JSON5 features that remain unsupported.
  - [ ] Update the root `README.md` Runestone description and `docs/api.md` to mention JSONC and its raw media type.
  - [ ] Update API contract fixtures/tests and generated artifacts that become stale; do not hand-edit generated OpenAPI output.

## Acceptance criteria

1. A new Runestone opens in strict JSON mode. JSON mode still rejects comments and trailing commas; JSONC accepts `//` comments, `/* ... */` comments and trailing commas in objects/arrays, but rejects JSON5-only syntax.
2. The top-level format switch is keyboard-accessible and announced. Switching modes changes parsing/validation only; it never modifies the buffer. A buffer invalid in the selected mode cannot be saved.
3. JSONC's editor mode has correct comment/string/number/punctuation highlighting, folding and bracket behavior; valid JSONC has no false parser or linter errors, and malformed JSONC diagnostics point to usable offsets.
4. Tree view, stats, paths and other value-based actions read JSONC values correctly without mutating source text. Format and Minify preserve all comments and value tokens. Sort keys is comment-safe or explicitly unavailable in JSONC. No default transform silently strips comments.
5. Import/drop recognizes `.jsonc` (including strict-JSON contents by extension), imports `.json` as JSON, and export uses the corresponding extension/media type. The optional Copy as strict JSON action, if shipped, preserves numeric/string tokens and never changes the editor buffer.
6. JSON/JSONC mode survives scratch-draft save/restore, seed hand-off, saved-document create/update/fetch and page reload. Changing only the mode marks the document dirty and persists it.
7. Existing database rows migrate as JSON, and fresh databases have the same schema. Existing clients omitting format continue creating strict JSON documents; omitted update format preserves the existing record format.
8. The Runestone API accepts and validates both modes, returns format in summaries and document records, filters by format consistently for legacy and paged lists, and preserves existing paging/search/author semantics. Raw URLs retain CORS/redirect behavior and return the correct format-specific media type.
9. Pensieve shows a JSON/JSONC badge and a URL-backed format filter without duplicating Runestone as another kind or breaking pagination totals; its copyable curl command uses the matching `Accept` media type.
10. Variant can import/open JSONC and structurally compare it; comments alone create no diff records, original pane text is preserved, and JSON Patch output remains strict JSON. Existing text mode and strict JSON comparisons remain unchanged.
11. Content-format detection offers JSONC to Runestone for comments/trailing commas before the YAML fallback, while ordinary strict JSON is still detected as JSON. Existing tools and JSON-only saved docs retain their current behavior.
12. All new parser, UI, server, migration, API-contract, Pensieve, Variant and e2e tests pass; the zero-vulnerability audit and the repository verification gate pass.

## Test checklist

### Unit

- [ ] Strict and JSONC validation/parser tests, including malformed comments, comment-like strings, trailing commas, JSON5 rejection, precise issue offsets, raw-number preservation, format/minify/safe-sort behavior, stats, paths and tree values.
- [ ] CodeMirror JSONC mode tests: no false errors for valid JSONC; actual JSONC errors remain reported and navigable.
- [ ] Draft/seed compatibility tests for missing format and round-trip persistence.
- [ ] Content-format detection, Runestone mode/import/export, Variant structural comparison/format/sort, Pensieve filter serialization and per-row curl media-type tests.

### Server and migration

- [ ] Usecase tests for JSON default, JSONC acceptance, JSONC rejection of JSON5, explicit format updates, omitted-format update preservation and size limits.
- [ ] Route/integration tests for list and paged format filters, accurate counts, format fields, backward-compatible request defaults, raw response media types, redirects and CORS.
- [ ] Apply the migration to a pre-PLAN-42 database containing JSON Runestones and verify their format is `json`; create a fresh database and verify the same schema/default.
- [ ] Regenerate and validate OpenAPI; run API coverage, strict response-contract and black-box API tests for changed routes.

### Component and end-to-end

- [ ] Runestone component tests cover switch/default, unchanged text on mode change, issue navigation, dirty/save state, draft restore, `.jsonc` auto-selection and matching export.
- [ ] Pensieve tests cover format badge/filter, URL and pagination resets, totals, other-kind behavior and SSE refresh.
- [ ] Variant tests cover both panes, comment-only no-diff, JSONC file import, saved JSONC Runestone load, comment-preserving format and strict JSON Patch export.
- [ ] Add browser journey coverage for import → JSONC save → reload → Pensieve filtering/reopen → Variant compare → export.
- [ ] Run the project `verify` skill, including `npm audit` at zero vulnerabilities, and `live-verify` the built app's JSON/JSONC toggle, import/export, Pensieve and Variant flow.
