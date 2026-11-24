# PLAN-44 — Runestone JSONL: newline-delimited records

## Goal

Add JSON Lines (`.jsonl`) as a third, opt-in Runestone format alongside JSON and JSONC. JSONL documents hold one strict JSON value per physical line, so Runestone gains line-aware validation and a record navigator while saved documents, raw URLs, hand-offs and the Pensieve retain the format. Existing JSON and JSONC behavior remains unchanged.

## Gate

PLAN-43 merged. Single PR.

## Verified against the codebase, not assumed

- **Runestone's shared JSON model is a single-root document today.** `client/src/core/json/jsonc.ts` defines `JsonFormat`, `JSON_FORMATS`, format labels/media types and parser options for `json`/`jsonc`; `client/src/core/json/index.ts` validates, formats, minifies, sorts, computes stats and paths for one root. `client/src/core/ui/JsonEditor.tsx` selects one CodeMirror language mode. JSONL needs line-scoped parsing and diagnostics; the existing single-document grammar must not be assumed to accept multiple roots.
- **Runestone already persists a per-document format.** `client/src/features/runestone/RunestonePage.tsx` keeps format in editor state, dirty checks, import/export and save/update; `draft.ts` and `core/runestoneSeed.ts` carry it across recovery and hand-offs. The server has the `RunestoneFormat` type, format-aware validation/filtering, and a `format` column introduced by migration `0014_runestone_format.sql`. The current enum and default are `json`/`jsonc` and `json`.
- **Pensieve already supports per-kind format filtering.** `client/src/core/library/types.ts` exposes `LibraryEntry.formats`, per-row labels and media types, and `LibraryQuery.format`; `registry.tsx` adapts Runestone summaries and sends the filter to the server. `PensievePage.tsx` keeps that filter in the URL and only displays it for the selected/single kind. JSONL should extend this path, not add another kind or client-side filtering.
- **The server's list query and total share the format predicate.** `server/src/modules/runestone/services/db-runestone-repository.ts` applies the format condition to list, page and count. The versioned routes validate request bodies, describe every response in OpenAPI, and the raw URL already negotiates JSONC's media type and browser-navigation fallback.
- **Content hand-offs use a shared registry.** `client/src/core/contentFormat/registry.tsx` checks strict JSON, then JSONC, before YAML and seeds Runestone with a format. A single JSONL record is indistinguishable from ordinary JSON by content alone; `.jsonl` filename selection therefore belongs in Runestone's import handler, while content detection can identify only an unambiguous multi-record document.
- **Pensieve is shell-level, not a feature.** It lives in `client/src/app/pages/` and consumes the shared `core/library/` registry. The Runestone feature must not be imported by Pensieve, and the existing Runestone module owns all persistence and API changes.

## Scope

**In:**

- A per-document JSONL mode in Runestone, with strict line-by-line validation, physical-line diagnostics, format-aware drafts/seeds/import/export/save/reopen, and a JSONL-specific CodeMirror mode.
- A **Record Navigator** in Runestone: show the current line/record number and valid/error counts, move to the previous/next line or enter a line number, jump from an error to its line/column, inspect that line's parsed value in Tree view, and copy one valid record.
- A non-mutating **Copy as JSON array** action for a fully valid JSONL document. Wrap the original record value slices in an array so raw number and string tokens are not rounded or rewritten; never change the editor buffer.
- Persist JSONL as Runestone's third format, filter it server-side in the Pensieve with accurate totals, show a JSONL badge, and use the correct `Accept` media type in copied curl commands.
- `.jsonl` import/drop/export, format-aware raw-data media types, content-format hand-off detection when multiple records make it unambiguous, documentation and focused regression tests.

**Out:**

- JSONL support in Variant, or a new document kind, module, table, route, or library stream.
- JSONC comments, trailing commas, JSON5 syntax, or multi-line JSON values in JSONL. An array or object on one line is one record, not a container whose members become records.
- Schema inference, field aggregation, record editing in a separate grid, record splitting into separately saved documents, or automatic conversion that changes the editor buffer.
- Guessing JSONL from one JSON value when there is no `.jsonl` filename or explicit format selection.

## Decisions & reasoning

### JSONL is a format of the existing Runestone kind

Extend the existing per-document format contract to `json | jsonc | jsonl`. Do not create a JSONL table, route, module, Pensieve kind or separate editor. The saved-document API, events, delete behavior and paging remain Runestone's; the format field, raw media type, list filter and Pensieve badge distinguish documents. Existing records stay `json`, omitted create formats stay `json`, and omitted update formats preserve the stored format. Drafts and seeds written before this change, and responses from an older hub with no format, continue to read as JSON.

### A record is one strict JSON value on one physical line

Accept any JSON value as a record: object, array, string, number, boolean or `null`. Parse each line independently as strict JSON. JSONL adds no comments or trailing commas. A blank or whitespace-only line is an invalid record, not something silently skipped; an empty document is invalid. LF and CRLF line endings are accepted; a bare CR is not a record separator. A final line terminator does not create an extra record. Require UTF-8: reject malformed byte sequences and a UTF-8 BOM (including on file import; inspect the bytes first if the browser's text decoder would replace invalid bytes or strip the BOM). A literal newline inside a string is invalid JSON; the two characters `\\n` inside a JSON string are ordinary string content. Report every invalid line with a useful one-based line and column and an editor offset; never save only the valid subset.

Treat the complete text as one Runestone document for the existing byte cap and save transaction. Do not impose an unrelated per-line cap. A format-only update re-validates the unchanged stored text as JSONL without reapplying the size cap, matching JSONC's established behavior.

### The editor must understand multiple roots without relaxing JSONL

Before choosing the CodeMirror implementation, test the installed JSON and JSONC language parsers against multiple top-level values, blank lines, malformed lines, strings containing escaped `\\n`, and JSONC-only syntax. A candidate is acceptable only if it highlights each record, produces no false errors for valid JSONL, preserves correct per-line diagnostics and bracket matching, and still rejects comments and trailing commas. If no maintained mode meets those conditions, add a focused local CodeMirror mode that provides per-record highlighting/bracket behavior, validates each physical line with the existing strict JSON parser, and maps diagnostics back to document offsets; do not install a second general-purpose JSON parser just to get a mode. If neither route can meet the editor contract, keep JSONL unavailable rather than showing the single-root parser's false errors.

The mode switch is configuration only and never rewrites the buffer or recreates the CodeMirror view. Preserve selection, scroll and undo history, as the JSON/JSONC switch does.

### The Record Navigator follows physical lines

JSONL has no single root value. In Code view, the navigator follows the editor cursor's physical line and shows total record lines and invalid-line count, with Previous, Next and a line-number field. Direct entry accepts only an integer from 1 through the current line count; an invalid or stale value reports the range and does not move the cursor. Invalid blank lines remain addressable error lines. In Tree view, show only the selected line's parsed value; a valid line remains inspectable even when another line is invalid. Clicking a diagnostic selects that line and moves the editor cursor to the exact column. Copy record is available only for a valid selected line. These controls describe the actual line boundaries rather than pretending the entire file is one JSON tree.

Copy as JSON array is part of the JSONL toolbar and is enabled only when every line is valid. It builds a JSON array from the original trimmed record slices, preserving raw tokens such as `9007199254740993` and `1.50`; it is a clipboard conversion only and never changes the source or saves automatically. Test the wrapped output against the original per-line values. If an input cannot pass that check, refuse the copy rather than stringify parsed JavaScript values.

### Transformations must keep every value on its record line

JSON and JSONC retain their existing behavior. In JSONL, Format, Minify and Sort keys operate on each record independently, preserve the number and order of record lines, and never emit a line break inside a record. They must preserve raw value tokens and refuse the entire operation without changing the buffer if any line is invalid or an output check fails. Sort keys sorts object keys recursively but does not reorder records or array elements. Unescape and Copy as JS are unavailable in JSONL with an accessible, actionable explanation because their current whole-document behavior has no unambiguous multi-record meaning.

If a per-record transformation cannot meet these guarantees with the existing source-preserving JSON utilities, disable that action in JSONL and state why; do not fall back to `JSON.parse`/`JSON.stringify`, which can round large numbers.

### Format travels through the existing API and hand-off paths

Runestone's `format` enum, validation, list filter, summary/event payload, save/update schemas, raw route and OpenAPI response all gain `jsonl`. New and existing API clients remain compatible: absent create format means JSON, absent update format means unchanged, and an absent list filter still includes every format. The format condition applies to both list shapes and to the paged total.

Use `application/jsonl` as Bifrost's raw JSONL media type and `Accept` value; do not describe it as an IANA-registered type. A browser navigation that asks for `text/html` but not `application/jsonl` receives the unchanged bytes as `text/plain`, so the Pensieve raw link displays them rather than downloading them. Preserve the existing URL, CORS, `Vary: Accept` and `nosniff` behavior.

The content-format registry checks strict JSON first and JSONC next. It may offer JSONL only when two or more complete strict-JSON records make the format distinguishable; a one-line `.jsonl` import is selected by its filename in Runestone. Keep the existing rigid-before-heuristic ordering ahead of YAML, and seed JSONL with its format. No feature imports another feature.

### Keep the persistence change additive

Extend the existing Drizzle format enum and generate the next migration after `0014`. Existing rows must remain JSON; upgraded and fresh databases must converge on the same default and accepted formats. Use the `db-migration` skill for the schema/migration change, and prove both upgrade and fresh-database behavior. Do not hand-edit `server/openapi.json`; regenerate it after route schemas change.

## API contracts

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/v1/runestone` | List Runestones | Add `jsonl` to the optional `format` enum. It filters legacy and paged results and the paged `total`; absent still lists all formats. |
| `POST /api/v1/runestone` | Save a Runestone | Accept `format: "jsonl"` and validate every line. An omitted format remains strict JSON. |
| `GET /api/v1/runestone/:slug` | Read a Runestone | Return the stored JSONL text byte-for-byte with `format: "jsonl"`. |
| `PUT /api/v1/runestone/:id` | Rename, edit or change format | Accept JSONL; omission preserves the stored format. Validate content under the effective format. |
| `GET /runestone/api/v1/:slug` | Public raw-data URL | Keep the path and CORS behavior. Send `application/jsonl` to data clients and `text/plain` to browser navigation; document both response media types. |
| `DELETE /api/v1/runestone/:id` | Delete a Runestone | Unchanged. |

No new route is added.

## Task checklist

- [ ] **JSONL parsing and editor**
  - [ ] Extend the client format contract and shared JSON utilities with strict per-line parsing, record ranges, counts, line/column diagnostics and JSONL-aware value/path helpers. Preserve JSON and JSONC defaults.
  - [ ] Add parser and file-import tests for all JSON value types, LF/CRLF (and bare-CR rejection), final newline, empty input, blank/whitespace lines, malformed UTF-8, BOM, malformed records, JSONC/JSON5 rejection, escaped `\\n`, offsets and line/column mapping.
  - [ ] Spike the installed CodeMirror JSON/JSONC grammars for multiple roots. Implement a verified mode or the focused per-line fallback above; test highlighting, valid/invalid gutter diagnostics, bracket matching and language switching without losing undo/selection/scroll.
  - [ ] Add JSONL-safe Format, Minify and Sort keys, or expose each unsupported action as accessibly unavailable with its reason. Verify all-or-nothing behavior, raw token preservation, record order and one-line-per-record output.
- [ ] **Runestone experience**
  - [ ] Add JSONL to the format switch, status/dirty/save logic, selected-format validation, Tree view and error navigation in `client/src/features/runestone/RunestonePage.tsx`.
  - [ ] Implement the Record Navigator: physical-line count, invalid count, Previous/Next, direct line selection, selected-record Tree view, error-to-line navigation and Copy record.
  - [ ] Add Copy as JSON array for a fully valid JSONL buffer, wrapping original record slices and checking that the result parses as a strict JSON array with identical per-line values; never stringify parsed values or alter the editor buffer.
  - [ ] Carry JSONL through `client/src/features/runestone/draft.ts` and `client/src/core/runestoneSeed.ts`; legacy cached drafts and old seeds without a format remain JSON.
  - [ ] Import/drop `.jsonl` by filename or media type, export with `.jsonl` and `application/jsonl`, and keep the selected format when creating, updating, reopening and reloading a saved document.
  - [ ] Extend Runestone unit/component tests for mode-only switching, per-line validation, navigation, transformations, copy, draft restore, imports/exports and save/update behavior.
- [ ] **Server persistence and API**
  - [ ] Extend the Runestone format type, validation, repository, list/count filters, bus summary and route DTOs to include JSONL. Preserve the whole-document byte cap and reject a save if any record is invalid.
  - [ ] Generate the migration after `0014` with existing records remaining `json`; use the `db-migration` skill and verify upgraded and fresh databases.
  - [ ] Update route schemas, all response descriptions/examples and raw media negotiation; regenerate `server/openapi.json` and pass OpenAPI lint, API coverage, strict response contracts and black-box tests.
  - [ ] Keep all server validation in the Runestone module/usecase boundary using its repository interfaces; do not put parsing in the HTTP route or access Drizzle outside the repository.
- [ ] **Pensieve and hand-offs**
  - [ ] Add JSONL to the Runestone `LibraryEntry.formats`, row label and media-type selection; ensure copied curl commands request `application/jsonl`.
  - [ ] Verify the URL-backed format filter reaches the server's page and count, resets the page correctly and preserves search, author, sorting, SSE refresh, legacy JSON links and all other kinds.
  - [ ] Extend `client/src/core/contentFormat/registry.tsx` and tests to recognize only unambiguous multi-record JSONL after JSON/JSONC and before YAML, and seed Runestone with `jsonl`.
  - [ ] Add component and browser coverage for `.jsonl` import → diagnostics and record navigation → save/reload → Pensieve badge/filter/reopen → raw URL/curl media type.
- [ ] **Documentation**
  - [ ] Update `client/src/assets/guides/json.md` to explain JSONL's one-strict-value-per-line rules, blank-line and final-newline behavior, record navigation and the JSON/JSONC distinction.
  - [ ] Update the README's Runestone/Pensieve descriptions and `docs/api.md` with the JSONL format, `format=jsonl` filter and raw media type.
  - [ ] Update directly related architecture, tech-stack and project-structure notes for the new format/editor mode; record any implementation deviations in the implementation PR.

## Acceptance criteria

1. New documents still default to strict JSON. Existing JSON and JSONC documents keep their current behavior and metadata.
2. JSONL accepts one strict JSON value per LF/CRLF-delimited line, including objects, arrays, strings, numbers, booleans and `null`; JSONC comments/trailing commas and JSON5 syntax are rejected.
3. LF and CRLF work, bare CR does not delimit records, and a single final line terminator creates no extra record. Empty/whitespace-only records, an empty document, malformed UTF-8, a BOM (including one in an imported file), malformed values and multi-line JSON values are reported rather than silently ignored.
4. Every invalid record has a useful one-based line/column and editor offset. Valid records remain inspectable when other lines fail, but the whole document cannot be saved until every line is valid.
5. The JSONL CodeMirror mode has no false errors for multiple valid records, correct line-scoped diagnostics and bracket behavior, and switching formats preserves buffer contents, selection, scroll and undo history.
6. The Record Navigator follows the editor cursor, addresses physical lines, rejects invalid/out-of-range line entries without moving, shows total and invalid counts, moves and jumps accurately, displays the selected valid value in Tree view, and copies only a valid selected record.
7. JSONL Format/Minify/Sort either preserve all raw value tokens, record order and line boundaries across the whole document, or are accessibly unavailable with a clear reason. No operation partially transforms invalid input; Unescape and Copy as JS explain why they are unavailable.
8. Copy as JSON array is enabled only for a fully valid document, keeps raw numeric/string tokens, produces valid strict JSON with the same record values in order, and never changes or saves the source buffer.
9. JSONL mode survives scratch-draft restore, hand-off seed, save/update/fetch, page reload and format-only changes. Missing format in old draft/seed/API data continues to mean JSON.
10. Existing database rows remain JSON after upgrade; fresh and upgraded databases have the same schema and default. Older clients that omit format keep their current create/update behavior.
11. The API validates JSONL, returns its format in summaries and records, filters both list forms and the paged total correctly, and serves byte-identical raw content as `application/jsonl` to data clients and `text/plain` to browser navigation.
12. Pensieve shows a JSONL badge and a URL-backed format filter without adding a kind or breaking pagination, search, author filtering, sorting, SSE refresh or other document kinds; copied curl commands use `Accept: application/jsonl`.
13. `.jsonl` filename import selects JSONL even for a single strict JSON value. Content detection selects JSONL only when multiple strict JSON records make it unambiguous; ordinary JSON and JSONC detection remains unchanged.
14. Focused unit, component, migration, API-contract and browser tests pass, followed by the zero-vulnerability audit and the repository `verify` gate. The built app's JSONL flow is live-verified.

## Test checklist

### Unit

- [ ] JSONL parser/transform/file-import tests cover every JSON value type, strict-mode exclusions, empty/blank records, malformed UTF-8, BOM, LF/CRLF/bare CR, final newline, escaped line-break content, line/column offsets, malformed records, safe formatting/minification/sorting, and preservation of large/raw numeric tokens.
- [ ] CodeMirror mode tests cover multiple valid roots, a bad line between valid records, JSONC-only syntax rejection, diagnostics and offsets, bracket matching, and switching modes without losing editor history or selection.
- [ ] Record Navigator tests cover previous/next/direct line selection, invalid blank-line slots, error jumps, selected-record tree values, copy behavior and stale/out-of-range line requests.
- [ ] Draft/seed compatibility, filename/media-type selection, content detection, format filter URL state, per-row badge and curl media-type tests pass.

### Server and migration

- [ ] Usecase tests cover JSONL accept/reject cases, all-or-nothing validation, size cap, omitted-format defaults, omitted-update preservation and format-only revalidation.
- [ ] Route/integration tests cover legacy and paged format filters, accurate totals, summary/full-record formats, older request compatibility, raw bytes, `Content-Type`, browser navigation, `Accept`, CORS and redirects.
- [ ] Apply the migration to a pre-PLAN-44 database containing JSON and JSONC Runestones and verify their formats are unchanged; create a fresh database and verify the same schema/default.
- [ ] Regenerate and validate OpenAPI; run API coverage, strict response-contract and black-box API tests for changed operations.

### Component and end-to-end

- [ ] Runestone tests cover format switch without text mutation, per-line status, record navigation, tree/copy, invalid-save prevention, draft restore and `.jsonl` import/export.
- [ ] Pensieve tests cover JSONL badge/filter, URL and pagination resets, totals, other-kind behavior, SSE refresh and per-row curl `Accept`.
- [ ] Add a browser journey for import → line validation/navigation → save → reload → Pensieve filter/reopen → raw URL/curl behavior, at desktop and mobile widths.
- [ ] Run the project `verify` skill, including `npm audit` at zero vulnerabilities, and `live-verify` the built app's JSONL editor, record navigator, persistence and Pensieve flow.
