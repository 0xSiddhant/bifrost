# PLAN-08 — Variant (JSON & text diff checker)

## Goal

A two-pane comparison tool at `/variant`. **JSON mode (default):** structural, semantic diffing — parses both sides, walks the trees, reports adds/removes/changes as navigable paths, immune to key order and formatting noise. **Text mode:** raw line diffing for any file type. Top-level toggle switches modes; invalid JSON gracefully falls back to Text.

## Gate

Starts after PLAN-07 (both parts) is merged. Hard reuse dependencies: `<JsonEditor>`, `core/json` utils (esp. `sortKeysDeep`, `formatJson`, `jsonStats`), tree view component, Runestone library APIs (pane pickers + slug deep-links), `--syn-*` and `--diff-*` tokens from PLAN-04.

## Scope

**In:** `variant` module (both profiles — pure client compute; the library picker simply hides when the runestone capability is absent), structural JSON diff engine, text diff via `@codemirror/merge`, 3-part layout with middle action rail, results drawer, comparison options, library integration, shareable compare URLs.
**Out (parked in PLAN-99):** JSON Patch export, `.patch`/unified-diff file export, three-way merge, language-aware highlighting in text mode. Diff-annotated tree view is an in-plan **stretch** task, not core.

## Decisions & reasoning

- **Structural diff = custom recursive walker (~150 lines, pure TS)** in `client/src/core/json/diff.ts`, emitting records `{op: add|remove|change|type-change, path, before, after}`. Rejected `jsondiffpatch` (own visual format fights our theming) and `deep-diff` (stale). Pure + property-testable + records reusable later (runestone version history idea). Both sides pass through `sortKeysDeep` first when ignore-key-order is on (default) — the reason that util was built shared in PLAN-07.
- **Array matching strategies (per-compare option):** *by index* (default), *by key field* (user names an identity key like `id` — true add/remove/move detection for API arrays), *as set* (order-insensitive multiset compare for tag-lists).
- **Comparison options (rail popover):** ignore key order (on), array strategy, numeric tolerance epsilon (off), ignore-path globs (`**.updatedAt` — kills timestamp noise), case-insensitive strings (off). Text mode equivalents: normalize CRLF/LF (on), ignore leading/trailing whitespace, ignore all whitespace, ignore case, ignore blank lines; split⇄unified view; word-wrap toggle (remembered per session).
- **Text engine = `@codemirror/merge`** — already shipping for pane alignment; gives line diff + character-level emphasis inside changed lines for free. No language highlighting packages (scope creep — PLAN-99).
- **Explicit Compare button, not live diff** (owner's model): recomputing a structural diff per keystroke on MB-scale docs janks. Editing after a compare marks results **stale** with a re-compare hint.
- **Diff coloring spans both panes** (agreed with owner after discussion): deletions red in the *left* pane (the only place deleted content physically exists), additions green in the *right*, modifications amber on both with char-level emphasis; panes scroll-locked so hunks align. Right-pane-only coloring would require synthetic ghost lines, breaking editability.
- **Results drawer** under the panes: stats chip (`+3 −1 ~7`) + grouped path list, click-to-jump both panes. Collapsed by default on desktop; **primary view on mobile** (stacked editors on 375px are unreadable; a tappable change list is not). Prev/next-change buttons in the rail.
- **Layout (owner's 3-part skeleton):** left pane · middle action rail · right pane. Rail = shared actions: mode toggle context, Compare, Clear (confirm), Format-both (normalizes spacing), Swap ⇄, options popover, code⇄tree switch, prev/next change. Per-pane: import file, load-from-library, editable label ("Original"/"Modified" defaults). Mobile: vertical stack (left → horizontal action bar → right), drawer leads, text mode defaults to unified view.
- **Tree view in rail = plain PLAN-07 tree** (read-only orientation aid). *Diff-annotated tree* (tinted nodes, badge counts on collapsed branches) = stretch task; the results drawer already delivers most of its value.
- **Invalid JSON in JSON mode → banner + auto-fallback to Text mode** ("Left side isn't valid JSON — switched to Text"), one-tap return once fixed. Never dead-end.
- **Library integration & URLs:** each pane gets a runestone picker; `/variant?left=<slug>&right=<slug>` preloads both sides (either param optional) — bookmarkable, shareable comparisons. 404 slug → pane-level friendly error, page still usable.
- **Theme tokens:** `--diff-add`, `--diff-remove`, `--diff-change` (+ subtle bg variants) — added to PLAN-04's checklist alongside `--syn-*`; Aurora leans on the green/violet aurora ends.

## Task checklist

**Engine (`client/src/core/json/`)**
- [ ] `diff.ts` walker: records, all three array strategies, tolerance, ignore-path glob matching, type-change detection; property tests (diff(a,a)=∅; apply-records equivalence on generated docs)
- [ ] Text normalization utils (line endings, whitespace, case, blank lines) — pure, unit-tested

**UI**
- [ ] Page shell: mode toggle, 3-part responsive layout, rail, per-pane labels/import/picker, swap, scroll-lock
- [ ] Compare flow: run, stale-marking on edit, clear
- [ ] Both-pane decoration layer (CM decorations bound to `--diff-*` tokens); char-level emphasis for changes
- [ ] Text mode: @codemirror/merge wiring, split⇄unified, normalization toggles, word-wrap
- [ ] Results drawer: stats chip, grouped list, click-to-jump, mobile-primary behavior; prev/next in rail
- [ ] Options popover (JSON + Text option sets, mode-aware)
- [ ] Invalid-JSON fallback banner + return path
- [ ] Library pickers + `?left/right=` slug loading + pane-level 404 state
- [ ] Capabilities/nav registration (hide picker when runestone capability absent — cloud-profile ready)
- [ ] *(stretch)* Diff-annotated tree view

## Acceptance criteria

1. Two 1 MB JSONs with identical data but shuffled keys + different formatting → JSON mode reports **zero** differences with ignore-key-order on.
2. Array of objects compared *by key field* correctly reports one modified item + one added when positions shifted — where by-index would report everything changed.
3. Deletion shows red in the left pane, addition green in the right, modification amber both sides with char emphasis; click a drawer row → both panes jump aligned.
4. Broken JSON on one side → banner + working text diff; fixing it and tapping return restores structural mode.
5. `/variant?left=…&right=…` with valid slugs opens pre-loaded and compared; with one bad slug, the other pane still loads and the page functions.
6. Mobile: stacked panes, drawer-first results, unified text view — usable end-to-end on iPhone Safari and Android Chrome.
7. `**.updatedAt` ignore-glob suppresses timestamp-only changes; CRLF-vs-LF-only files diff clean in text mode with normalization on.

## Test checklist

- [ ] Unit/property: walker (all ops, strategies, tolerance, globs), normalizers, glob matcher corpus
- [ ] Component: stale-compare behavior, fallback banner, drawer jump targeting
- [ ] Manual: theme switch mid-compare (tokens only), large-doc perf pass, device pass
