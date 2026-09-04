# PLAN-26 — Variant: diff export (JSON Patch + unified diff)

## Goal

Variant's two modes each gain a real, standards-shaped export: JSON mode gets **"Export as JSON Patch"**, turning its already-computed `DiffRecord[]` into an RFC 6902 patch file; Text mode gets **"Export as unified diff"**, producing a `.patch` file shaped like `git diff`/`diff -u` output — not a custom format, so it opens correctly in any tool that already reads one. Both are pure client compute, matching Variant's existing architecture; neither adds a server route.

## Gate

PLAN-25 merged. Single PR.

## Verified against the codebase, not assumed

This plan's whole design leans on the exact shape of code that already exists, read directly rather than recalled from the backlog note that originally proposed it:

- `core/json/diff.ts`'s `DiffRecord` is `{ op: 'add'|'remove'|'change'|'type-change', path, leftPath, rightPath, before?, after?, aspect?: 'key-order' }`. `path`'s own doc comment — *"Display path — right side for adds, left side for everything else"* — is confirmed by reading every `emit()` call site: it really is `rightPath` for `add` and `leftPath` for everything else, with no exception, including inside `walkMatched`'s by-key rebasing (which rebases the *display* `rightPath` for a moved-but-matched element, never `path`/`leftPath`, so a nested change inside a moved element still reports its true source-document location).
- `walkArrayByKey`'s own doc comment states plainly that "moves are no-ops" — a matched-and-relocated array element with identical content never emits an add/remove pair at all, only its genuinely-changed descendants do. Nothing in this plan needs to detect or express a move; RFC 6902's `move` op is correctly out of scope, not overlooked.
- For the default "index" array strategy specifically, `walkArray`'s index branch only ever emits `remove` for trailing left-side indices and `add` for trailing right-side indices — confirmed by reading the loop bounds, not inferred. This is why the descending-remove-sort fix is sufficient for the common case without needing a fully general reordering algorithm.
- `client/package.json` has no `diff`, `jsondiffpatch`, `deep-diff`, `fast-json-patch`, or `rfc6902` dependency today (checked directly) — both `toJsonPatch`/`applyJsonPatch` and the unified-diff formatter are new code/dependency, not an existing utility this plan overlooked.
- `features/variant/compare.ts`'s `compareText` already produces normalized `left`/`right` strings via the same options the UI exposes (trim/whitespace/case/blank-lines) — the unified-diff export reuses these exact strings, so the export always matches what the user configured, not the raw pane contents.

## Scope

**In:**
- `core/json/jsonPatch.ts`: `toJsonPatch(records): JsonPatchOp[]` (the DiffRecord → RFC 6902 mapping) and `applyJsonPatch(doc, ops): unknown` (used to verify every generated patch actually reproduces the target document before it's offered for download).
- A new dependency, `diff`, for the unified-diff formatter — chosen deliberately over hand-rolling one; see Decisions.
- "Export as JSON Patch" (JSON mode) and "Export as unified diff" (Text mode) actions in Variant's existing rail/results drawer, each downloading a file client-side.
- A mandated spike, before the export UI is built, confirming the exact header shape `diff` produces against what "looks like other tools" actually means here (git's shape vs. classic POSIX `diff -u`'s).

**Out:**
- Everything else still sitting in PLAN-99's Variant rows — three-way merge, language-aware text highlighting, the diff-annotated tree view, Runestone version history. None of those are touched or made easier by this plan in a way worth scoping in; each is its own real design problem.
- Applying a JSON Patch file *back into* Variant (import-and-preview). This plan only produces files; consuming one is a separate, unasked-for feature.
- A server-side copy of either export. Both stay client-only, like the rest of Variant.
- `move`/`copy`/`test` RFC 6902 operations. The walker never emits a "this element moved" record (`walkArrayByKey`'s own doc comment: "moves are no-ops") — there is nothing to map onto `move`, and `add`/`remove`/`replace` are the only three ops this plan ever needs to produce or verify.

## Decisions & reasoning

### JSON Patch export starts from a walker that already does most of the work

`core/json/diff.ts`'s `DiffRecord` (`{ op: 'add'|'remove'|'change'|'type-change', path, leftPath, rightPath, before?, after?, aspect? }`) maps onto RFC 6902 almost directly: `add` → `{op:"add", value: after}`, `remove` → `{op:"remove"}`, `change`/`type-change` → `{op:"replace", value: after}` (RFC 6902 has no "type changed" concept — replacing a value's type is still just replacing the value). The walker's own doc comment on `path` — *"Display path — right side for adds, left side for everything else"* — turns out to already be exactly the right RFC 6902 path in every case: JSON Patch operations apply sequentially against the evolving *source* document, so `remove`/`replace` need the source-side (left) location and `add` needs the target-side (right) location for where the new value lands, which is precisely what `path` already resolves to record-by-record. Nothing about the walker needed to change for this plan.

### JSON Pointer escaping is a real, easy-to-miss spec requirement — not optional

RFC 6902's `path` is an RFC 6901 JSON Pointer, and RFC 6901 requires `~` to be escaped as `~0` and `/` as `~1` **within each segment** before joining with `/`. A key that legitimately contains a slash or tilde (`"a/b"`, `"~config"`) is not exotic in real JSON — API responses, file-path-shaped keys — and an unescaped pointer either points at the wrong location or fails to parse at all. `toJsonPatch` escapes every path segment before building the pointer string; this is worth a dedicated unit test with exactly these two characters, not just trusted by inspection.

### Key-order-only diffs cannot be expressed in RFC 6902 — say so, don't ship a silently empty file

A `DiffRecord` with `aspect: 'key-order'` describes object keys appearing in a different order — which, per JSON's own spec, is not a semantic difference at all, and RFC 6902 has no operation for "reorder these keys" (there's nothing to *reorder* from a spec that considers objects unordered). `toJsonPatch` filters these records out before mapping. If that leaves zero operations — the two documents differ *only* in key order — the export action says so explicitly ("These documents are structurally identical; JSON Patch has nothing to export") instead of silently handing back an empty `[]` that would look like a bug.

### The one real correctness risk: array index ordering under sequential application

JSON Patch operations apply **sequentially**, each one mutating the document the next one sees. `remove` operations at different indices of the *same* array are the hazard: removing index 3 first shifts what used to be index 4 down to index 3, so a naive "remove /4" emitted afterward now targets the wrong element (or is out of bounds entirely). This is invisible in the walker's own output — `DiffRecord`s are just a flat list with no ordering guarantee relative to each other — and it is exactly the kind of thing that reads as correct in a code review and breaks on a real document. `toJsonPatch` groups records by their parent array path and sorts each group's `remove` operations **descending by index** before flattening back into one ops array, so an earlier removal never invalidates a later one's target. This closes the risk for the common (default, "index" strategy) case cleanly, since index-strategy adds/removes are always trailing.

**It does not, by itself, prove correctness for the "key" or "set" array strategies**, where removes and adds can land at arbitrary, non-trailing positions and a fully general "always produces a minimal, valid sequential patch" algorithm is a genuinely hard problem — it's the reason dedicated JSON-diff/patch libraries exist as their own projects rather than being a small utility function. Rather than either overclaim correctness here or restrict the export to "index" strategy only (a real, currently-working case), the plan closes the gap a different way:

### Correctness is verified by replaying the patch, not asserted

Before any JSON Patch file is offered for download, `applyJsonPatch` runs the generated ops against a deep clone of the **left** (before) document and the result is deep-equal-compared against the **right** (after) document. This is cheap (the documents are already in memory, application is linear) and turns "this should be correct" into "this was checked, for this exact pair of documents, right now." When it matches — which is expected to be the overwhelming common case, including every "index"-strategy compare — the download proceeds normally. When it doesn't — realistically only reachable via "key"/"set" strategy edge cases — the export is blocked with a clear message ("this diff can't be exported as a single sequential patch — try the index array strategy") rather than silently handing over a file that looks right and replays wrong. `applyJsonPatch` itself only ever needs to implement the three ops this plan emits (`add`/`remove`/`replace`), which keeps it small enough to property-test directly: generate a random document mutation, diff it, apply the resulting patch to the original, assert equality — the same testing shape PLAN-08 already established for the walker itself ("diff(a,a)=∅; apply-records equivalence on generated docs").

### Unified diff export uses a real dependency, not a hand-rolled formatter — because "look like other tools" is the explicit ask

Text mode's on-screen diff already comes from `@codemirror/merge`'s `Chunk.build()` (`features/variant/compare.ts`), which gives changed-line ranges but nothing resembling a unified-diff *file* — no context lines around each change, no hunk merging when two changes sit close together, no `@@ -l,s +l,s @@` headers, none of it. Hand-rolling that formatting correctly (context-line assembly, hunk-merging when windows overlap, the header's line-count edge cases) is real spec work with sharp corners, and the owner's own framing — *"try to keep standard structure so its output look same like other tools"* — is specifically asking for a result indistinguishable from what people already recognize, which is a much easier thing to buy from a mature, dedicated library than to approximate by hand. This plan adds `diff` (the well-known, small, dependency-free npm package many JS-based tools already build on) and uses its `createTwoFilesPatch`/`createPatch` for the actual hunk formatting, computing over the same normalized text `compareText` already produces (so whatever trim/case/whitespace/blank-line options the user has set apply identically to the export).

**This does mean the export runs its own diff pass rather than reusing `@codemirror/merge`'s already-computed chunks** — two different (both correct) Myers-diff implementations can chunk a given pair of texts slightly differently at the margins, so the exported hunks are not guaranteed byte-identical in grouping to what's rendered on screen, even though the content they describe is the same change. Accepted as the right trade for spec-correctness over on-screen fidelity; not expected to be visible in ordinary use, and nameable if it ever is.

### A mandated spike, before the export UI is built: confirm the exact shape `diff` actually produces

`diff`'s documented output includes an `Index: <filename>` line and a `===...===` separator by default in some call shapes — a classic `diff`/patch-tool convention, but **not** what `git diff` or `git format-patch` themselves emit, and "looks like other tools" most plausibly means the git shape, given this is a developer's LAN tool living beside JSON/YAML/XML editors that already speak git's adjacent conventions elsewhere in spirit. Before the export button is wired up: install `diff`, generate a real patch from a real Variant text compare, and read the actual output. **State what changes either way, not just "we'll check":** if the default output includes the `Index:`/`===` lines, strip them (or find the option that omits them) so the file opens as a plain `git apply`-compatible patch; if the default already omits them, no change needed and this spike closes in five minutes. Either outcome is a one-line decision once the real output is in hand — the risk is shipping the wrong-looking file without ever having looked.

### Both exports are pure client compute — no new server surface

`variant`'s own module is already capability-only (`register()` is a deliberate no-op — all comparison runs client-side, architecture.md's own words); both new exports extend that, not break it. `## API contracts` below says so explicitly rather than omitting the section, matching PLAN-18's pattern for a genuinely route-free plan.

### Where the buttons live

Each mode's existing rail/results-drawer area (`ResultsDrawer.tsx`, or the mode-specific rail actions beside Compare/Clear/Swap) gains one export action, active only once a compare has actually run — there is nothing to export before that, the same precondition every other results-dependent action in Variant already has. JSON mode's button reads "Export as JSON Patch"; Text mode's reads "Export as unified diff". Downloaded filenames use the pane labels already in the UI (`"Original"`/`"Modified"` by default, or whatever the user renamed them to) for the `--- a/<label>` / `+++ b/<label>` unified-diff headers and for a sensible default filename on both exports.

## API contracts

None. Both exports are pure client compute — `variant`'s server module stays a capability-only no-op, unchanged by this plan.

## Task checklist

**Engine (`client/src/core/json/`)**
- [ ] `jsonPatch.ts`: `toJsonPatch(records: DiffRecord[]): JsonPatchOp[]` — JSON Pointer escaping (`~`→`~0`, `/`→`~1`), `key-order` records filtered out, array-`remove` operations sorted descending by index within each parent array
- [ ] `jsonPatch.ts`: `applyJsonPatch(doc: unknown, ops: JsonPatchOp[]): unknown` — implements exactly `add`/`remove`/`replace`, nothing else
- [ ] Property tests: `applyJsonPatch(left, toJsonPatch(diffJson(left, right)))` deep-equals `right` over generated documents (index strategy); a fixed fixture with `~` and `/` in a key round-trips correctly; a key-order-only pair produces zero ops

**Dependency + spike**
- [ ] Add `diff` to `client/package.json`
- [ ] Spike: generate a real patch from a real compare, read its actual header shape, decide keep-or-strip the `Index:`/`===` lines against git's own convention — record the outcome before building the UI around it

**Variant export logic (`client/src/features/variant/`)**
- [ ] `export.ts` (new): `exportJsonPatch(records, leftLabel, rightLabel)` — calls `toJsonPatch`, runs the `applyJsonPatch` verification against the actual left/right documents, returns either a downloadable file or a clear "can't be exported" reason
- [ ] `export.ts`: `exportUnifiedDiff(leftText, rightText, leftLabel, rightLabel)` — calls `diff`'s formatter over the same normalized text `compareText` already produces, applying the spike's decision on header shape
- [ ] Client-side file download (Blob + temporary `download`-attribute anchor, the same mechanism already used elsewhere in this app — no server round-trip)

**UI**
- [ ] JSON mode: "Export as JSON Patch" action in the rail/results drawer, disabled until a compare has run; blocked-with-reason state when the replay check fails; blank-diff state when only key-order records exist
- [ ] Text mode: "Export as unified diff" action in the same slot, disabled until a compare has run
- [ ] Both use the pane labels for file naming and diff headers

**Docs**
- [ ] `decisions.md`: log the `diff`-dependency choice and the verify-by-replaying-rather-than-asserting design, dated, with the real reasoning
- [ ] `tech-stack.md`: add a `diff` row (small, single-purpose, unified-diff/patch formatting — the reason a dependency was worth it here, mirroring PLAN-25's `archiver` precedent)
- [ ] `context-sync` pass once implemented; update `.agent/memory/progress.md`; archive this plan file into `completed/` in the implementation PR

## Acceptance criteria

1. A JSON compare with adds, removes, and replaces (index strategy) exports a patch that, applied via `applyJsonPatch` to the left document, reproduces the right document exactly — verified with a real multi-op fixture, not a single-op toy case.
2. A key whose name contains `/` or `~` round-trips correctly through the exported patch's JSON Pointer escaping.
3. Two documents differing only in key order export zero operations and say so explicitly, rather than downloading an empty-looking `[]` file.
4. An array with multiple elements removed (index strategy) exports a patch whose removes are ordered so that applying them sequentially, in the order they appear in the file, produces the correct result — proven by a fixture with at least two removes in the same array, not just one.
5. A "key"-strategy or "set"-strategy compare that the replay check finds does not round-trip correctly is blocked from export with a clear message, never silently downloaded as if it were correct.
6. A text-mode compare exports a `.patch` file whose header shape matches the spike's recorded decision (git-shape, `Index:`/`===` stripped, unless the spike concluded otherwise) — checked against the spike's own written conclusion, not re-decided ad hoc during review.
7. The exported unified diff's hunks, applied with a real patch tool (`git apply` or `patch -p1`) against the original left text, reproduce the right text.
8. Both export actions are absent/disabled before a compare has run, and appear only once results exist.
9. Filenames and diff headers use the pane's actual labels, including a renamed label, not a hardcoded "Original"/"Modified".
10. `variant`'s server module registration is unchanged — `git diff` on the implementation PR touches no file under `server/src/modules/variant/`.
11. `diff` is the only new dependency added; no second diff/patch library is introduced for the JSON side.

## Test checklist

- [ ] Unit: `toJsonPatch` — one fixture per op kind, the escaping corpus (`~`, `/`, both together, nested), key-order filtering, descending-remove ordering within one array
- [ ] Property: `applyJsonPatch(left, toJsonPatch(diffJson(left, right, { arrayStrategy: { kind: 'index' } })))` equals `right` over generated document pairs
- [ ] Unit: `applyJsonPatch` in isolation — each of the three ops against a small fixed document, including a `remove` at a nested path and a `replace` of a whole subtree
- [ ] Unit: a "key"/"set"-strategy fixture engineered to *not* round-trip cleanly under naive sequential application, confirming the export correctly blocks rather than ships it
- [ ] Unit: `exportUnifiedDiff` header shape matches the spike's recorded decision; hunk content matches a known-good fixture
- [ ] Integration/manual: a real exported `.patch` file applied via `git apply --check` (or `patch -p1 --dry-run`) against the original left text succeeds
- [ ] Component: both export buttons' disabled/enabled states across the compare lifecycle (no results → results → stale-after-edit)
- [ ] Live-verify: export both file types from a real compare in the built app, open the JSON Patch file and confirm it's valid JSON shaped as documented, open the `.patch` file in a text editor and confirm it reads like a normal git patch

## On completion

Both source rows (**Variant: JSON Patch export (RFC 6902)** and **Variant: unified `.diff`/`.patch` file export**) are already removed from `PLAN-99-future-backlog.md`'s Tier B table, replaced with a promotion note pointing here — that happened when this plan was scheduled, not deferred to this section. Archiving this file into `completed/` happens in this plan's own implementation PR, per the usual convention.

