import { log } from '../log';
import { compareItems, mergeHeads, type Offsets, type Stream } from './paging';
import type { LibraryEntry, LibraryItem, LibraryKind, LibraryQuery } from './types';

export interface LibraryStep {
  /** The merged page, in `query`'s order. */
  rows: LibraryItem[];
  /** Rows taken from each kind — the next boundary is `offsets + consumed`. */
  consumed: Offsets;
  /** Each answering kind's total under the query. */
  totals: Offsets;
  /** The server's page size (every kind reads the same LIST_PAGE_SIZE). */
  limit: number | null;
  /** Union of the answering kinds' unfiltered author facets. */
  authors: string[];
  /** Kinds whose request rejected. Never a reason to render nothing. */
  failed: LibraryKind[];
}

/**
 * One step of the Pensieve's page walk (PLAN-31): ask every kind for a page
 * from its own offset, then k-way-merge the heads and keep the first `take`.
 *
 * **`allSettled`, never `all`** (PLAN-21, unchanged). With four independent
 * endpoints, `all` would turn one flaky module into an empty page. A failed
 * kind contributes no rows, and its name goes to `failed` so the page can show
 * the rest plus a Retry strip.
 *
 * The fan-out is client-side on purpose: a server endpoint returning "all
 * documents" would have to read four modules' tables from one place, which
 * rule 2 forbids. What replaced the old whole-collection fetch is not a bigger
 * fetch but real cross-source pagination — this merge over per-kind offsets,
 * walked by `LibraryPager` — so the browser never holds more than four pages
 * of rows at once, however large the library grows.
 *
 * `take` omitted means "one server page", read back from the envelope — the
 * client never hardcodes LIST_PAGE_SIZE.
 */
export async function loadLibraryStep(
  entries: readonly LibraryEntry[],
  query: LibraryQuery,
  offsets: Offsets,
  take?: number,
): Promise<LibraryStep> {
  const settled = await Promise.allSettled(
    entries.map((entry) =>
      entry.listPage(query, { offset: offsets[entry.kind] ?? 0, limit: take }),
    ),
  );

  const streams: Stream[] = [];
  const totals: Offsets = {};
  const authors = new Set<string>();
  const failed: LibraryKind[] = [];
  let limit: number | null = null;

  settled.forEach((result, index) => {
    const entry = entries[index];
    if (!entry) return;
    if (result.status === 'fulfilled') {
      const page = result.value;
      streams.push({ kind: entry.kind, rows: page.items });
      totals[entry.kind] = page.total;
      for (const author of page.authors) authors.add(author);
      limit = limit === null ? page.limit : Math.min(limit, page.limit);
      return;
    }
    failed.push(entry.kind);
    // The page degrades visibly, but a kind that keeps failing while the others
    // answer is exactly the failure nobody reports — it just looks like the
    // documents were never saved.
    log.reportError(`library kind "${entry.kind}" failed to load`, result.reason, {
      module: 'pensieve',
    });
  });

  const size = take ?? limit ?? 0;
  const { rows, consumed } = mergeHeads(streams, size, (a, b) =>
    compareItems(a, b, query.sort, query.order),
  );
  return { rows, consumed, totals, limit, authors: [...authors], failed };
}
