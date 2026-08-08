# PLAN-21 — Pensieve (unified library shell)

## Goal

One library listing every saved document — runestones (JSON), eddas (Markdown) and groots (YAML) — with a type filter, over the existing per-module tables and APIs. Storage stays uncoupled; only the *view* is unified.

This is the scheduled promotion of PLAN-99's **Unified library shell** row.

## Name — it is already called Pensieve

No new name is needed, and inventing one would be a mistake. The codebase already calls this thing the Pensieve **twice**:

- `features/runestone/PensievePage.tsx` — eyebrow *"the pensieve · every stone remembered"*, `<h2>Pensieve</h2>`, at `/runestone/pensieve`
- `features/edda/EddaLibraryPage.tsx` — eyebrow *"the pensieve · every manuscript kept"*, `<h2>Pensieve</h2>`, at `/edda/pensieve`

…and the name is woven through both editors' copy: **"Save to Pensieve"**, **"Back to the Pensieve"**, **"Kept in the Pensieve"**, plus Ollivanders' Runestone card (*"saved to the Pensieve"*). Two pages already share one title at two URLs, which is the confusion this plan exists to end. A third name would mean three names for one concept.

So: **Pensieve**, promoted from a nested segment to the top-level route `/pensieve`. It is three easy syllables (PEN-sieve), already in the product's vocabulary, and every existing string keeps working.

*(If you do want the unified shell to be distinct from the per-tool ones, the alternatives are **Codex** (CO-dex — a bound collection, two syllables) or **Alexandria**. Both are worse here, because they would compete with a name the app already teaches its users on every save button.)*

## Gate

PLAN-18 merged.

> **Recommended execution order: 18 → 21 → 19 → 20**, i.e. **run this before PLAN-19 (Groot)**, not after its number.
>
> PLAN-19's task list contains *"`GrootLibraryPage` (Pensieve)"* — a **third** copy of a page this plan deletes. Run 21 first and that task collapses to **one registry entry**, and `/groot/pensieve` is a redirect that never needs a page behind it. Run it after and Groot builds a library page that is deleted within the following PR. This plan can equally run last; it will then delete three pages instead of two. The ordering is the owner's call, but there is a day of work in it.

Single PR — `feat/plan-21-pensieve`.

## Decisions & reasoning

### This is a de-duplication, not a new page

The two library pages are near-identical twins, and the codebase already admits it: **`EddaLibraryPage` reuses Runestone's `rune-lib-*` CSS classes**. Both hold the same state (`rows`, `q`, `author`, `sort`, `order`, `error`), run the same SSE-refresh effect, offer the same four sorts, and render the same `EmptyState`.

The API clients are twins too — `RunestoneSummary` and `EddaSummary` are **field-for-field identical** (`id`, `name`, `slug`, `authorDeviceId`, `sizeBytes`, `createdAt`, `modifiedAt`), as are `RunestoneSort`/`EddaSort` and `RunestoneListQuery`/`EddaListQuery`. Groot would be a third copy of all of it.

So the plan's real content is a **`core/library/` registry**, keyed by kind:

```
LibraryKind = 'runestone' | 'edda' | 'groot'
LibraryItem = { kind, id, name, slug, authorDeviceId, sizeBytes, createdAt, modifiedAt }
```

with one registry entry per kind carrying its label, capability id, `list()`, `remove()`, editor route builder, icon and palette slot. **Adding a fourth document type becomes one entry, not a fourth page** — which is the whole return on this plan.

The per-tool API clients (`core/runestone.ts`, `core/edda.ts`, `core/groot.ts`) stay exactly as they are; the registry adapts them. They each own their own endpoints and are used by their own editors.

### Client-side fan-out, never a server-side aggregate

The listing is `Promise.allSettled` across the enabled kinds, merged and sorted in the browser.

A server endpoint returning "all documents" would have to read three modules' tables from one place, which **rule 2 forbids** (modules never import each other) — the only legal shapes would be a core-owned aggregate table or a bus-fed projection, both of which couple storage that PLAN-99's note explicitly says stays uncoupled. The client already has all three API clients sitting in `core/`, so the fan-out is free and the boundary stays intact.

### `allSettled`, not `all` — partial failure is a first-class state

With three independent endpoints, one being down must not blank the page. A failed kind shows the others plus a non-blocking strip — *"Eddas couldn't be loaded · Retry"* — and the type filter marks that kind as unavailable. `Promise.all` would turn one flaky module into an empty library.

### The scale bound is written down, not hidden

The client list APIs take `q`/`author`/`sort`/`order` and **no `limit`/`offset`** — they already return the whole matching set, so merging three sorted lists client-side is trivially correct today. That is only true because this is a household tool holding tens to hundreds of documents.

Stated plainly so the next person does not discover it the hard way: **if a library ever reaches thousands of rows, merge-sorting in the browser is the thing that breaks first**, and the fix is real cross-source pagination (a merge cursor over three sorted streams), not a bigger fetch. Not built now — building it now would be speculative work against a load this app does not have.

### The type badge's colour follows the kind, not the row position

`rules/coding.md` says card colour follows position. This is a **scoped exception**, on exactly the reasoning logged for Accio's hostname-hash tile (2026-07-25): the badge exists so a type is recognisable at a glance *while the list is being searched, filtered and re-sorted*, and that only works if JSON keeps one colour as rows move. Hub and portal cards are untouched and stay positional.

### The old library routes redirect and their pages are deleted

- `/runestone/pensieve` → `/pensieve?type=runestone`
- `/edda/pensieve` → `/pensieve?type=edda`
- the existing `/runestone/library`, `/runestone/mimir` and `/edda/library` aliases repoint **straight at `/pensieve?type=…`**, not at the old URLs, so nothing double-redirects
- `PensievePage.tsx` and `EddaLibraryPage.tsx` are deleted

Every "Pensieve" button in both editors already reads correctly against the new destination; only the `navigate()` targets change.

### `/pensieve` is a new top-level route, so it joins `RESERVED_ROOTS`

`pensieve` is currently only ever a *nested* segment, so it is **not** in the reserved list. Promoting it to a first segment means adding it to `RESERVED_ROOTS` **and** the `reserved-roots.test.ts` assertion list in the same change (`rules/coding.md` §Routing) — otherwise a Portkey slug could create `/go/pensieve` shadowing the page.

### No new server module

The shell is pure client compute over three existing capabilities, so it needs no capability of its own — it renders when **at least one** library kind is present, and the registry filters kinds by `capabilities.modules`. Adding a module purely to gate a page derived entirely from other modules' capabilities would be ceremony (this is the one place PLAN-18's `toolbox` precedent does *not* transfer: toolbox's tools had no other capability to hang from).

That makes the page a cross-cutting shell over several features — exactly what `app/pages/` already holds (Midgard, Ollivanders, Diagon Alley) — so `app/pages/PensievePage.tsx` is where it goes, with all the logic that deserves testing (registry, merge, sort, filter) in `core/library/` where it can be unit-tested without a DOM.

### Rows, not cards

Accio's shelf became a card grid (2026-07-25) because a bookmark is a short, glanceable thing and the list grows fast. A document row carries a longer name plus size, both timestamps and an author, and it is scanned by name — so rows stay, gaining a type badge column, inside the ≥1024px full-width breakout the other document pages use.

### Out of scope

- **Accio.** A saved link is not a document: no slug, no size, no content, no editor route, and its shelf is a browsing surface with its own grid and tag model. Folding it in would mean a `LibraryItem` where half the fields are null.
- **Cross-type actions** (bulk delete, move, export several at once). This plan unifies the *view*; a multi-select action model is its own design pass.
- **Real cross-source pagination** — see the scale bound above.

## Tasks

- [ ] `core/library/`: `LibraryKind`, `LibraryItem`, the registry (label · capability · `list` · `remove` · editor route · icon · palette slot), `mergeItems`, `sortItems`, `filterItems` — all pure
- [ ] Fan-out loader with `Promise.allSettled`, per-kind error state, capability filtering
- [ ] `app/pages/PensievePage.tsx`: type chips (All · JSON · Markdown · YAML), search, author filter, four sorts + order flip, row list with type badge, delete-with-confirm, `EmptyState`, per-kind failure strip with Retry
- [ ] Live updates: subscribe to `runestone.saved|deleted`, `edda.saved|deleted`, `groot.saved|deleted` (each only when its kind is enabled)
- [ ] Route `/pensieve` + `?type=` deep link; repoint `/runestone/pensieve`, `/edda/pensieve`, `/runestone/library`, `/runestone/mimir`, `/edda/library`; **delete `PensievePage.tsx` and `EddaLibraryPage.tsx`**
- [ ] `pensieve` → `RESERVED_ROOTS` **and** `reserved-roots.test.ts` (same change)
- [ ] Repoint both editors' Pensieve buttons; check the "Save to Pensieve" / "Kept in the Pensieve" copy still reads true
- [ ] Generalise the `rune-lib-*` CSS to the shell (it is already shared by two pages) + the type badge
- [ ] Failure paths logged per `rules/coding.md` — a kind that fails to load gets a line
- [ ] Docs sync (`architecture.md`, `project-structure.md`, `decisions.md`, `progress.md`, `plans/README.md`) + archive this file **in this PR**
- [ ] If PLAN-19 has already shipped: delete `GrootLibraryPage` too and redirect `/groot/pensieve`. If it has not: note in PLAN-19 that its library task is now one registry entry

## Acceptance criteria

1. `/pensieve` lists runestones, eddas and groots together, each row carrying a type badge, sorted by one shared sort across all three.
2. The type chips filter to one kind and back; `?type=edda` deep-links straight to that filter and Back restores the previous one.
3. Search, author filter and sort **compose across types** — searching "notes" with author *Loki* sorted by size returns the right rows from every kind.
4. Deleting a row removes it from the list and from its own tool's storage, and the row disappears **on a second open device within a heartbeat** (SSE).
5. Saving a new document in any editor makes it appear in an already-open Pensieve without a reload.
6. With one list endpoint blocked, the other kinds still render, a Retry strip names the failed kind, and Retry recovers it without a page reload. **The page is never blank because one module is down.**
7. With `edda` absent from `/api/capabilities`, no Markdown chip, no edda fetch, and no `edda.*` subscription — proven in the network panel, not by reading the code.
8. `/runestone/pensieve`, `/edda/pensieve`, `/runestone/library`, `/runestone/mimir` and `/edda/library` all land on the right filtered view in **one** redirect each.
9. Both editors' Pensieve buttons reach the new page, and no route or link anywhere still points at a deleted page (checked by grep as well as by clicking).
10. A `/go/pensieve` Portkey slug is refused (422) — proven through the API.
11. Adding a fourth kind is one registry entry: a test registers a fake kind and it lists, filters, sorts and deletes with **no page change**. This is the criterion that proves the plan's actual value.
12. 375 / 768 / 1280 with no horizontal overflow; the type badge stays legible at 375px.
13. Net line count goes **down** — two pages and their duplicated state replaced by one page plus a tested core module.

## Tests

- [ ] Unit (`core/library`): merge ordering across kinds for all four sorts and both directions; stable ordering for equal keys; filter composition (q + author + type); capability filtering; the fake-kind registry test behind criterion 11
- [ ] Unit: `allSettled` fan-out — one rejection yields the other kinds' items plus that kind's error, never a throw
- [ ] Component: type chip changes the URL and the list; delete confirms before firing; the failure strip's Retry re-runs only the failed kind
- [ ] Server: `reserved-roots` guard covers `pensieve`
- [ ] Live-verify (`live-verify` skill): three kinds listed together on the built server; save in one editor → appears in a second device's open Pensieve over SSE; delete round-trip; **one list endpoint blocked to prove criterion 6**; every legacy redirect followed once; zero console errors
- [ ] Manual: a real phone on the LAN — row legibility and the type chips at 375px

## On completion

**PLAN-99 is already clean** — its Tier B **Unified library shell** row was deleted on 2026-08-04 when this plan was scheduled, under the rule adopted that day (a backlog row goes when its idea is *scheduled*, not when the plan completes), with a `PROMOTED … to PLAN-21` note in its place.

So this PR's only paperwork is the docs sync in Tasks plus **archiving this file to `.agent/plans/completed/`**.
