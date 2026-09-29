# PLAN-31 — Pagination

## Goal

Every list the app reads from the database today is fetched as one big batch and treated as the whole collection: the Pensieve asks each of its four document kinds for the server's 200-row default, Accio asks for 500, Portkey for 1000. Past those numbers rows silently vanish — and on Accio, whose search and tag filter run in the browser, a bookmark past row 500 cannot even be found. This plan makes those lists page for real. The **Pensieve** gets numbered pagination — a vertical `‹ 1 … 4 5 6 … n ›` pager that floats in the bottom-right corner on iPad-and-larger screens and sits inline under the list on a phone. **Accio** and **Portkey** get infinite scroll with a "Load more" button as the fallback. Page sizes drop to an industry-standard default of 30 (maximum 100, GitHub's REST convention), set in `.env`. The literal name is the name: this is plumbing, not a place.

## Gate

PLAN-30 merged. Single PR, no parts (owner's instruction: "only one plan").

## Verified against the codebase, not assumed

- **Every list endpoint already takes `limit`/`offset`** and orders deterministically — `server/src/modules/{runestone,edda,groot,atlas}/usecases/manage-*.ts` clamp `limit ?? 200` to `[1, 500]`; `accio/usecases/manage-links.ts` the same; `portkey/usecases/manage-portkeys.ts` `limit ?? 500` to `[1, 1000]`. The route schemas mirror those maximums. No endpoint returns a total count, and every one returns a bare JSON array.
- **Document lists already return summaries, not content** — `db-runestone-repository.ts` selects `SUMMARY_COLUMNS`; the four document repositories are line-for-line the same shape (`orderBy(direction(sortColumn), asc(<table>.id))`, sorts `name` = `lower(name)` / `created` / `modified` / `size`, filters `q` = `name LIKE` and `author` = exact `author_device_id`).
- **Accio's repository** sorts `created` / `title` = `lower(coalesce(title, url))` / `url` = `lower(url)`, tiebreak `asc(id)`, and filters `q` (title or URL `LIKE`) and `tag` (exact element via `json_each`). **Portkey's** has one fixed order: `desc(created_at), asc(slug)`, filter `q` over slug/URL/note.
- **Client fetches:** `client/src/core/library/load.ts` fans out with `Promise.allSettled`, sends no `limit`, and its own doc comment already names this plan's fix ("real cross-source pagination — a merge cursor over three sorted streams — not a bigger fetch"). `features/accio/useShelf.ts` fetches `{ limit: 500 }` once and then filters and sorts in the browser through `shelf.ts`'s `filterLinks`/`sortLinks`/`allTags`. `features/portkey/api.ts` sends `limit: 1000`, and `PortkeyPage.tsx` filters `q` in the browser.
- **`PensievePage.tsx`** (read in full): the type chip is applied **client-side** after every kind has loaded (`filterItems(items, { kind })`); the author dropdown is built from `authorsRef`, which is the union of authors seen in unfiltered loads; every SSE event for a kind reloads that kind. `?type=` already lives in the URL.
- **The logged decision this reverses:** decisions.md 2026-07-25 — "The Accio shelf UI filters and sorts client-side over the SSE-maintained list … a household shelf is hundreds of rows." Pagination and client-side filtering cannot coexist (the filter would only ever see one page), so this plan supersedes that decision and logs a new dated row rather than editing the old one.
- **The CLI reads two list endpoints as bare arrays:** `cli/src/core/portkey.ts` (`bifrost portkey ls`, which sends only `q` and relies on the server default of 500) and `cli/src/core/clipboard.ts` (Hermes, out of scope). It never lists documents or Accio. A globally installed CLI can be older than the server.
- **SQLite row-value comparison works** in the bundled engine — ran `select (2,'b') > (2,'a')` through the installed `better-sqlite3`: SQLite 3.53.2, returns `1`. Keyset `WHERE (key, id) < (?, ?)` is therefore available without expanding it into `OR` clauses.
- **Fixed-position UI already on screen:** the toast host is bottom-**centre** (`core/ui/ui.css`, z 70); notifications are top-right (`notify.css`, z 80); the guide drawer is right-edge (z 40/41) but is never shown on the Pensieve (PLAN-30 gives it no guide); the Heimdall modal scrim is z 50; the mobile bottom nav exists only at `max-width: 640px` (`--bottomnav-h`). The bottom-right corner is free on the Pensieve.
- **Pensieve width:** `.lib-wrap` breaks out to `min(105rem, 100vw − 2·space-8)` at ≥1024px, leaving a 32px gutter — narrower than a pager column, so the pager **will** sit over the rows' right-aligned actions (Read · Present · curl · API · Delete) unless the rows reserve room for it.
- **SSE reconnects are observable:** `core/sse.ts` exposes `bifrostEvents.onStatus(listener)` with `'connecting' | 'open' | 'closed'`. A transition back to `'open'` after a drop means events may have been missed while it was down.
- **Config plumbing:** modules receive `deps.config: AppConfig` (`core/module.ts`); per-module limits are nested (`config.runestone.maxDocKb`). Since #78 (2026-09-24), only `DEPLOY_PROFILE`, `STORAGE_ROOT`, `PORT` and `HEIMDALL_PIN` are required; every other key has a default that `.env.example` repeats, and `npm run setup` warns on drift.

## Scope

**In:**
- An opt-in **paged response** on six list endpoints (`runestone`, `edda`, `groot`, `atlas`, `accio`, `portkey`) carrying a total count, the page size used, and either an offset (documents) or a cursor (Accio, Portkey).
- Two new `.env` keys: `LIST_PAGE_SIZE` (default 30) and `LIST_PAGE_MAX` (default 100).
- **Pensieve:** numbered pages over the merged four-kind list; a vertical floating pager on wide-and-tall screens, an inline one otherwise; `?page=` in the URL.
- **Accio and Portkey:** infinite scroll with a "Load more" fallback; search, tag filter and sort move to the server.
- A "Showing X–Y of Z" / "Showing X of Z" label on all three pages.

**Out:**
- **Hermes.** It can never exceed `CLIPBOARD_MAX_ENTRIES` (100); its risk is payload bytes, and the fix for that (short previews, fetch-on-copy) would break copying on iOS over plain-LAN http, where `core/copy`'s fallback only works synchronously inside the tap. Owner agreed to skip it.
- **The CLI.** No `bifrost` command changes. The plan keeps the CLI working (see "Legacy array responses stay exactly as they are") but does not teach `portkey ls` to page.
- Pagination anywhere else (the audit log, Midgard's upload/download lists, Loki's saved transforms). Those are not in the owner's list.
- Any server endpoint that reads more than one module's table. The Pensieve merge stays client-side (rule 2, and the 2026-08-08 decision it rests on).

## Decisions & reasoning

### The paged response is opt-in; legacy array responses stay exactly as they are

A request with `paged=true` gets an envelope; a request without it gets today's bare array with today's defaults and maximums, unchanged. The owner asked for smaller defaults everywhere, and every page in the app gets them — all three pages switch to `paged=true`, and the paged form is where `LIST_PAGE_SIZE` applies. ⚠️ **What deliberately does not shrink is the legacy array form.** `bifrost portkey ls` sends no `limit` and prints what comes back: dropping its default from 500 to 30 would make an already-installed CLI silently show 30 go-links with no hint that more exist — exactly the silent-truncation bug this plan exists to remove, moved from the browser to the terminal. The same holds for anyone scripting `curl` against these endpoints. Keeping the old form byte-for-byte also means no existing route test changes meaning. When the CLI later learns to page, the legacy defaults can be retired in that plan.

Envelope shapes (TypeScript, shared by name, not by import — server and client are separate workspaces; named `…ListPage` so they never collide with the `AccioPage`/`PortkeyPage` React components):

```ts
// documents (runestone, edda, groot, atlas) — offset mode, for numbered pages
interface DocumentListPage<T> { items: T[]; total: number; limit: number; offset: number; authors: string[] }
// accio — cursor mode
interface AccioListPage { items: AccioLink[]; total: number; limit: number; nextCursor: string | null; tags: string[] }
// portkey — cursor mode
interface PortkeyListPage { items: Portkey[]; total: number; limit: number; nextCursor: string | null }
```

`total` counts rows matching the **current filters**. `authors` and `tags` are the opposite: facets over the **whole** table, unfiltered — see "Facets ride in the envelope".

### Page size: 30 by default, 100 at most — GitHub's REST convention

The owner had no numbers yet and asked for the industry standard. GitHub's REST API defaults `per_page` to 30 and caps it at 100, and that is also a comfortable size for both shapes here: 30 Pensieve rows is two to three screens on a laptop, and 30 Accio cards is about six rows of the ≥1024px auto-fill grid — enough that one infinite-scroll step visibly fills the screen. Both numbers are `.env` keys (`LIST_PAGE_SIZE=30`, `LIST_PAGE_MAX=100`, zod-validated so `LIST_PAGE_SIZE ≤ LIST_PAGE_MAX`, both ≥ 1) per the project rule that limits are never hardcoded. The client never hardcodes a size either: it omits `limit`, and the envelope's `limit` tells it what the server used. The paged form clamps a requested `limit` to `LIST_PAGE_MAX` in the usecase (the route schema keeps the legacy maximum so the legacy form is unaffected).

### The Pensieve pages by offset, merged client-side with a per-kind offset vector

Numbered pages mean random access to "page k", which is what offsets are for — a cursor can only step forward. The difficulty is that page k is a slice of a **merge** of four sorted streams, and no server can compute that merge (rule 2). The mechanism:

- **A page boundary is a vector of per-kind offsets.** Page 1 starts at `{runestone: 0, edda: 0, groot: 0, atlas: 0}`. To build a page, ask every kind for `limit = s` rows from its own offset, k-way-merge the four heads, and take the first `s`. The merge also reports how many rows it consumed from each kind, so the **next** page's boundary is exact: `offset_i + consumed_i`. Nothing is guessed and no row is fetched twice.
- **Totals are exact.** Each kind's envelope carries its own `total`; the page count is `ceil(Σ total_i / s)`.
- **The last page is computed backwards, cheaply.** Asking every kind for its first `r = Σtotal − (n−1)·s` rows in the **reversed** order, merging, and reversing gives page n exactly, and its forward boundary is `total_i − consumed_i`. This depends on the reversed order being the exact mirror of the forward one — see the next decision.
- **Other jumps walk from the nearest known boundary.** Known boundaries (page 1, page n, every page visited since the last invalidation) are cached; reaching page k walks forward or backward from the nearest one, one page (four parallel `limit = s` requests) per step. A backward step is the forward step run in the reversed order: kind i's offset from the end is `total_i − start_i`, and the consumed counts are subtracted instead of added.
- **Totals come first.** Every envelope carries `total`, so a cold start (first load, Refresh, a filter change, `?page=` typed into the address bar) always begins with the page-1 request — which is also page 1's rows — and only then knows `n` and which end is nearer. The pager only offers first, last, and current ±1 (see "The pager"), so an in-app jump is at most one step. The deep case is loading `/pensieve?page=37` cold, which walks from whichever end is nearer — at most `n/2` sequential steps, each four parallel small requests on a LAN — with the rows area showing its busy state meanwhile.
- **What "exact" rests on.** A walk is exact provided the four streams don't change while it runs. A change that lands mid-walk always arrives as an SSE event, and every event drops the boundary cache (see "Live updates"), so an off-by-one boundary lives at most until that event is handled — it is never cached and reused.
- **With a type chip on, there is no merge.** One kind means page k is simply `offset = (k−1)·s` on that kind's endpoint. The chip therefore moves from a client-side filter to **which kinds are fetched** — keeping it client-side would turn a page of 30 into however many of those 30 happened to match.

⚠️ **The merge must be a true k-way merge of the four streams' heads, never "concatenate and sort".** The two are equal only if the client comparator agrees with SQLite's ordering for every row, and it does not in general: `lower()` in SQLite folds ASCII only and compares UTF-8 bytes, while JavaScript's `toLowerCase()` folds all of Unicode and compares UTF-16 code units. A head merge takes each stream's rows in the order its server gave them, so a comparator disagreement can only change how two *kinds* interleave — never how many rows are consumed from a kind — and the offset accounting stays exact. A concat-and-sort can reorder rows *within* a kind and silently skip or repeat one on the next page. The comparator still mirrors SQLite as closely as it cheaply can (ASCII-only lowercase, code-point comparison) so the interleaving matches what a user expects.

### Paged ordering breaks ties in the sort direction, not always ascending

Today every repository breaks ties with `asc(id)` whatever the direction, so `sort=size&order=desc` and `order=asc` are **not** mirror images when sizes tie — and ties on `sizeBytes`, and on `name`, are ordinary. The backwards last-page computation needs an exact mirror, so the paged form orders by `(sortKey, id)` **both** in the requested direction; the client comparator does the same with `(sortKey, id, kind)`. The legacy array form keeps `asc(id)` untouched. For Accio and Portkey the same rule makes their keyset cursors a single row-value comparison (`(key, id) < (?, ?)` descending, `>` ascending).

### Accio and Portkey page by keyset cursor, not offset

Infinite scroll only ever asks for "the rows after the last one I have", which is precisely what a cursor answers, and it answers it correctly while the list changes underneath. With offsets, a link saved from a phone while you scroll pushes every row down one, so the next request repeats the last row; a deletion pulls every row up one, so it silently skips one. Both pages receive exactly those events live over SSE, so this is the normal case, not an edge. The cursor is the last row's `(sortKey, id)` plus the `sort` and `order` it was minted under, base64url-encoded JSON, opaque to the client; the server recomputes nothing from it except the comparison. A cursor whose `sort`/`order` disagrees with the request, or that does not decode, is a `400 BAD_CURSOR`, never a silent restart from the top. Accio's `sortKey` for `title` is the expression `lower(coalesce(title, url))`, selected as an extra column so the cursor carries exactly what SQLite compared. Portkey has one order, `(created_at desc, slug desc)` in paged form, with `slug` as its unique key.

Two consequences are accepted and stated: a row whose **sort key changes** mid-scroll (Accio's title enrichment arrives as `accio.updated` seconds after a save) can cross the cursor and appear twice or not at all in the current scroll — the client dedupes by id, and the upsert described below keeps the one it has current; and the client-side sort Accio used for titles (`localeCompare`, base sensitivity) gives way to the server's `lower()`, which orders non-ASCII and punctuation slightly differently. One sort order, owned by the server, is the point.

### Facets ride in the envelope, computed over the whole collection

Two controls today are built from "every row the page loaded": the Pensieve's author dropdown (decisions.md 2026-07-19: "author filter options accumulate from unfiltered listings") and Accio's tag chips plus the `TagField` suggestions (`allTags(links)`). With pages, "every row loaded" is one page, so the dropdown would lose devices and the tag row would lose tags. Each paged document response therefore carries `authors` (distinct `author_device_id` over the kind's whole table) and Accio's carries `tags` (distinct tags over the whole shelf). They are unfiltered on purpose — that is what lets you switch from one author to another without first clearing the filter, the behaviour the 2026-07-19 decision chose — and they are cheap (`SELECT DISTINCT` over a column; `json_each` over the tags). Tags a live `accio.saved` introduces are unioned in locally until the next fetch.

### Live updates: exact where cheap, a "Refresh" chip where not

- **Accio and Portkey.** An SSE insert is placed only where it provably belongs: it must pass the active filter (Accio reuses `shelf.ts`'s `filterLinks` as that predicate — its only remaining job; for a non-ASCII search term its JavaScript case-folding can disagree with SQLite's ASCII-only `LIKE`, which at worst mis-places one live insert until the next fetch), and it must sort **within** the rows already loaded (at the top for newest-first, or anywhere when there is no `nextCursor`). Otherwise it is left for the scroll to reach. `total` moves by one when the row matches the filter. Updates (`accio.updated`, `portkey.saved` on an existing slug, `portkey.hit`) patch a loaded row in place — it keeps its position until the next fetch even if its sort key moved — and a loaded row that no longer passes the filter is removed and `total` decremented. Deleting a loaded row removes it and decrements `total`. Events about rows that were never loaded change no rows; their effect on `total` is handled by the re-count below.
- **Pensieve on page 1** refetches page 1 on any event for a displayed kind (its boundary is all zeros, so it can never be stale). **On any other page** an event cannot be placed without knowing where it landed relative to the page's boundary, so the page does not move under the reader: a non-blocking "The library changed · Refresh" chip appears, and the cached boundaries (everything except page 1) are dropped. Refresh — or any navigation — rebuilds the target page from page 1 or page n. Offset pagination shifting rows between pages after a change is the industry-normal behaviour; not yanking the page someone is reading is the part worth guaranteeing.
- **Your own delete** on any page refetches the current page from its own boundary, which stays exact because the deleted row sat after it. If that empties the last page, the page moves to the new last page. ⚠️ The server also broadcasts that delete back over SSE; the page remembers the `kind:id` it just deleted and ignores that one echo, otherwise every delete on page 2+ would raise the "library changed" chip for the user's own action.
- **When the effect on `total` can't be derived, re-count.** A delete event carries only an id, so for a row that was never loaded the client cannot know whether it matched the active filter; the same goes for an update that may move an unloaded row into or out of the filter. In those cases Accio and Portkey issue one debounced `paged=true&limit=1` request (same filters) and take its `total`, rather than guessing. Loaded rows and inserts are always derived locally.
- **An SSE reconnect is a change.** When `bifrostEvents.onStatus` reports `'open'` after a drop, events may have been missed: the Pensieve treats it like any change event (page 1 refetches, other pages show the chip) and Accio/Portkey re-count `total` and refetch the first batch, upserting it by id — rows added or changed during the outage appear. A row deleted elsewhere during the outage stays visible until the next reload; that gap is stated rather than papered over, since closing it would mean refetching every loaded batch.
- **A failed kind** contributes nothing and is named in the retry strip, exactly as today (`allSettled`); page counts are over the kinds that answered. Retry drops the boundary cache and rebuilds the current page number (clamped) with the recovered kind included.
- **A selected author stays selectable** even when switching the type chip to a kind that author never saved in: the dropdown is the union of the fetched kinds' `authors` plus the current selection, so the control never shows a value that is not among its options.

### The pager: vertical and floating on iPad-and-up, inline on a phone

The owner specified a vertical `‹ 1, 2 … n ›` control floating at the bottom-right corner on iPad and larger, and on a phone a normal pager at the end of the list. The window is the standard one: first, last, current ±1, an ellipsis where numbers are skipped, and prev/next arrows — at most nine controls. Ellipses are not clickable; a user reaching page 17 of 40 does it by the ends and the arrows, which is also what keeps every in-app jump at one walk step.

- **Floating** when `(min-width: 768px) and (min-height: 600px)`. The width bound is the owner's "iPad +" (768px is iPad portrait); the height bound exists because a phone in landscape is 844×390 — iPad-wide but so short that a ~330px vertical control would cover most of the screen. Fixed at `right`/`bottom` = `max(space-6, env(safe-area-inset-*))`, z-index 30 (above page content, below the guide drawer at 40 and the modal scrim at 50, so a Heimdall modal still covers it).
- **Inline** otherwise: a horizontal row under the last list row, in normal document flow — the phone behaviour the owner described.
- ⚠️ **While the pager floats, `.lib-rows` reserves an inline-end gutter** the pager's width plus `space-4`, so no row's Delete or API button ever sits underneath it. Without this, at ≥1024px the 32px breakout gutter is narrower than the pager and it would cover the last visible rows' actions.
- Rendered only when there is more than one page. `nav aria-label="Pages"`, real `<a>` links carrying `?page=`, `aria-current="page"` on the current one, and visible focus rings.

Changing pages pushes a history entry (Back returns to the previous page), scrolls the list's top edge into view (instant under `prefers-reduced-motion`), and keeps the old rows on screen, dimmed with `aria-busy`, until the new ones arrive — no blank flash on a LAN round trip. Changing the search, author, sort, order or type chip drops `?page=` (replace, not push). A `?page=` that is not a positive integer reads as 1; one past the last page clamps to the last page (replace).

### Infinite scroll with a real "Load more" fallback

A sentinel after the last row is watched by an `IntersectionObserver` with `rootMargin: '600px'`, so the next batch is usually in before the reader reaches the end. The fallback CTA is not decoration — it is what appears whenever automatic loading can't or didn't happen: when `IntersectionObserver` is absent, when a batch fails ("Couldn't load more · Try again", which never retries automatically so a dead server isn't hammered), and always as a visible "Load more" button under the sentinel so keyboard and switch-access users are not dependent on scrolling. Only one batch is in flight at a time; a filter change aborts it (`AbortController`) and starts over, so a slow response for the old filter can never append into the new list. "Showing 90 of 312" sits beside the filters; at the end it reads "All 312 shown".

### Shared pieces live in `core/`, on both sides

The six server modules all need the same limit clamping, cursor codec and envelope type, and modules may not import one another, so they live in a new `server/src/core/paging.ts` — not under `core/http/`, because the usecases (not only the routes) call the cursor codec and the limit clamp, and a usecase depending on an HTTP-layer file would be the wrong direction. On the client, Accio and Portkey share one `core/useCursorList.ts` hook and one `core/ui/LoadMore.tsx`; the pager and the Pensieve's paging algebra live in `core/ui/Pager.tsx` and `core/library/paging.ts` (pure, DOM-free, where the tests run). Each repository still writes its own `count` and keyset `WHERE` — the SQL is per-table, and pretending otherwise would be a generic query builder nobody asked for.

## API contracts

| Method & path | Change | Notes |
|---|---|---|
| `GET /api/{runestone,edda,groot,atlas}?paged=true[&offset][&limit][&q][&author][&sort][&order]` | New paged form | Returns `DocumentListPage<Summary>`. `limit` defaults to `LIST_PAGE_SIZE`, clamped to `LIST_PAGE_MAX`. Order is `(sortKey, id)` both in `order`'s direction. `authors` is unfiltered. |
| `GET /api/accio?paged=true[&cursor][&limit][&q][&tag][&sort][&order]` | New paged form | Returns `AccioListPage`. `cursor` absent = first page. Mismatched or undecodable cursor → `400 BAD_CURSOR`. `tags` is unfiltered. |
| `GET /api/portkey?paged=true[&cursor][&limit][&q]` | New paged form | Returns `PortkeyListPage`. Order `(created_at desc, slug desc)`. Same cursor errors. |
| Same six paths **without** `paged` | **Unchanged** | Bare array, legacy defaults (200/500; Portkey 500/1000) and `asc(id)` tiebreak, byte-for-byte as today — CLI and scripts keep working. |

## Task checklist

**Server core**
- [ ] `core/config`: `LIST_PAGE_SIZE` (default 30) and `LIST_PAGE_MAX` (default 100) → `config.paging.{pageSize,maxPageSize}`; zod: integers ≥ 1, `pageSize ≤ maxPageSize`
- [ ] `.env.example`: both keys, documented inline
- [ ] `core/paging.ts`: `pageLimit(requested, config)`, `encodeCursor`/`decodeCursor` (base64url JSON `{ sort, order, key, id }`; `AppError(400, 'BAD_CURSOR')` on decode failure or sort/order mismatch), the envelope types, and a `pagedQuerySchema` fragment (`paged: boolean`, `cursor: string maxLength 512`). Fastify's default ajv setup is expected to coerce the query string `paged=true` to a boolean — the first route test proves it; if it does not, the fragment becomes `paged: { enum: ['true'] }` and nothing else changes

**Server modules**
- [ ] `runestone`, `edda`, `groot`, `atlas` — each: repository `count(filter)`, `listAuthors()`, and a paged list ordered `(sortKey, id)` in one direction; usecase `executePage()` beside the unchanged `execute()`; route branches on `paged`; `ports.ts` interface additions
- [ ] `accio`: repository `count`, `listTags()`, keyset `after` condition with `sortKey` selected as a column; usecase `executePage()`; route
- [ ] `portkey`: repository `count`, keyset on `(created_at, slug)`; usecase `executePage()`; route

**Client core**
- [ ] `core/{runestone,edda,groot,atlas}.ts`: `list*Page(query, { offset, limit })` returning the envelope; existing `list*()` untouched (editors and anything else keep using them)
- [ ] `core/accio.ts`: `listLinksPage(query, cursor)`
- [ ] `core/library/types.ts`: `LibraryEntry.listPage(query, offset, limit): Promise<DocumentListPage<LibraryItem>>`; `LibraryQuery` gains nothing (the kind set is passed separately)
- [ ] `core/library/registry.tsx`: `listPage` on all four entries
- [ ] `core/library/paging.ts`: `compareItems(a, b, sort, order)` (direction-aware on `(key, id, kind)`, ASCII-only lowercase, code-point compare); `mergeHeads(streams, s, compare)` → `{ rows, consumed }`; `lastPage(...)` via reversed streams; `pageWindow(current, count)` → the pager's numbers and ellipses; the boundary cache type
- [ ] `core/library/load.ts`: `loadLibraryPage(entries, query, boundary, s)` keeping `allSettled` semantics (a failed kind contributes nothing and is named in `failed`); scale-bound comment rewritten to describe the new mechanism
- [ ] `core/useCursorList.ts`: generic cursor hook — `items`, `total`, `nextCursor`, `status`, `loadMore()`, `reset(query)`, `upsert`/`remove` helpers, one request in flight, `AbortController` on reset, dedupe by key
- [ ] `core/ui/LoadMore.tsx`: sentinel (`IntersectionObserver`, `rootMargin: '600px'`), "Load more" button, error + "Try again", "Showing X of Z" / "All Z shown"
- [ ] `core/ui/Pager.tsx`: vertical floating / horizontal inline, `pageWindow`-driven, links carry `?page=`, `aria-current`, the `(min-width: 768px) and (min-height: 600px)` query
- [ ] `core/ui/ui.css`: pager styles (z-index 30, safe-area insets), the floating-state gutter on `.lib-rows`, Load-more styles; tokens only

**Pages**
- [ ] `app/pages/PensievePage.tsx`: `?page=` state, boundary cache, type chip → fetched kinds, authors from envelopes, "Showing X–Y of Z", stale chip on page > 1, own-delete refetch, empty-last-page step-back, busy state, scroll-to-list-top
- [ ] `features/accio/useShelf.ts` → `useCursorList`; `AccioPage.tsx`: server-side `q`/`tag`/`sort` (debounced `q`, 200ms like the Pensieve), tags from the envelope, `LoadMore`; `shelf.ts`: `sortLinks`/`allTags` removed if unused, `filterLinks` kept as the live-insert predicate
- [ ] `features/portkey/api.ts` + `usePortkeys.ts` → `useCursorList`; `PortkeyPage.tsx`: server-side `q` (debounced), `LoadMore`; the create-conflict path (`setQ(conflictSlug)`) still surfaces the existing link

**Docs**
- [ ] `architecture.md`: the paging mechanism (envelope, legacy form, the Pensieve offset vector) and the rewritten Pensieve scale-bound paragraph
- [ ] `tech-stack.md`: nothing new is a dependency — no row
- [ ] `decisions.md` / `progress.md`
- [ ] `context-sync` pass once implemented; archive this plan file into `completed/` in the implementation PR

## Acceptance criteria

1. With 75 documents spread across the four kinds and `LIST_PAGE_SIZE=30`, the Pensieve shows pages 1–3 of 30, 30 and 15 rows; walking 1 → 2 → 3 shows every document exactly once, in the same order as one merged sort of all 75 would give — checked against the database, not by eye.
2. Jumping straight to the last page, and loading `/pensieve?page=2` cold, show exactly the rows criterion 1 found on those pages.
3. With a type chip on, pages count only that kind's documents, and every page is full except the last.
4. At 1280×900 and 1024×768 the pager floats bottom-right as a vertical column and covers no row action (Delete, API, curl, Present, Read) at any scroll position; at 390×844 and at 844×390 it sits inline under the list.
5. The pager shows first, last, current ±1 and ellipses, never more than nine controls; Back after changing pages returns to the previous page; `?page=0`, `?page=abc` and `?page=999` land on page 1, page 1 and the last page respectively.
6. A document saved from another device appears live on page 1; on page 2 a "library changed" chip appears instead and the rows do not move until Refresh.
7. Deleting the only row on the last page moves to the new last page; deleting a row mid-page pulls the next row up with no duplicate and no gap, and your own delete never raises the "library changed" chip.
8. The author dropdown lists every device that has saved a document of an enabled kind, not only the authors on the current page.
9. On Accio with 120 links, scrolling loads batches of 30 until "All 120 shown"; a search or tag filter finds a link that sits past row 100, and the tag row lists every tag on the shelf.
10. Saving a link from another device while scrolled mid-shelf adds it at the top (newest-first), increments the count, and the next batch contains no duplicate of any row already shown; deleting one mid-shelf skips nothing in the next batch.
11. With `IntersectionObserver` stubbed out, the "Load more" button loads every batch; with the server stopped mid-scroll, "Couldn't load more · Try again" appears and nothing retries on its own.
12. Portkey with 120 links behaves as in criteria 9–11 (search, batches, live create/hit/delete), and a create that conflicts with an existing slug still surfaces that link.
13. The six endpoints **without** `paged` return byte-identical responses to `develop` for the same data and query, and `bifrost portkey ls` lists more than 30 go-links unchanged.
14. A malformed `cursor`, or one reused with a different `sort`/`order`, returns `400 BAD_CURSOR`.
15. After the server is restarted while a page is open (SSE drops and reconnects), a document or link saved during the outage shows up — on Pensieve page 1 directly, on later pages via the chip, on Accio/Portkey in the count and at the top.

## Test checklist

**Unit (server)**
- [ ] `core/paging.test.ts` — cursor round-trip, tampered/garbage cursor → `BAD_CURSOR`, sort/order mismatch → `BAD_CURSOR`, `pageLimit` default/clamp
- [ ] `core/config` — both keys' defaults, `pageSize > maxPageSize` rejected at boot
- [ ] Each of the six usecases — `executePage` clamps, echoes `limit`, returns `total` under filters, facets unfiltered

**Integration (server, `fastify.inject`)**
- [ ] Documents: paged order is the exact reverse of the flipped order **including ties** (seed equal `sizeBytes` and equal names); offset pages cover every row once
- [ ] Accio: keyset pages cover every row once under `created`/`title`/`url` × `asc`/`desc`, with tied titles; insert and delete between two page requests cause no duplicate and no skip; `tag` + `q` compose with `total`
- [ ] Portkey: the same keyset properties with tied `created_at`
- [ ] Legacy form: response bodies identical to today for all six endpoints (snapshot against the pre-change fixture)

**Unit (client, pure)**
- [ ] `core/library/paging.test.ts` — `mergeHeads` consumption counts; a comparator that disagrees with the streams' own order still consumes exactly by stream order (the ⚠️ in "The Pensieve pages by offset"); forward walk vs. reversed last page agree; `pageWindow` for 1, 2, 7 and 40 pages at each position
- [ ] `core/useCursorList.test.ts` — dedupe, abort on reset (a late old-filter response is discarded), one request in flight, live insert placement rules, total bookkeeping, the `limit=1` re-count on an unloaded-row delete, reconcile on SSE reconnect

**Component**
- [ ] `PensievePage.test.tsx` — `?page=` parsing and clamping, type chip resets page, stale chip on page > 1, own-delete refetch **without** raising the stale chip, empty-last-page step-back, authors from envelope plus the retained selection, SSE reconnect treated as a change, Retry of a failed kind rebuilds the current page
- [ ] `Pager` — floating vs inline by media query, ≤ 9 controls, `aria-current`
- [ ] `LoadMore` — sentinel triggers, button fallback without `IntersectionObserver`, error state does not auto-retry

**Live-verify**
- [ ] Seed ~75 documents, ~120 Accio links, ~120 go-links into a scratch `STORAGE_ROOT`; built server; headless Chromium at 1280×900, 1024×768, 390×844 and 844×390, both themes: criteria 1–12 walked through, including a second browser target saving/deleting while the first is mid-list
- [ ] `bifrost portkey ls` against the same server lists all 120 (criterion 13)
