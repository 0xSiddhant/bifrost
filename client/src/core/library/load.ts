import { log } from '../log';
import { mergeItems, sortItems } from './select';
import type { LibraryEntry, LibraryItem, LibraryKind, LibraryQuery } from './types';

export interface LibraryLoad {
  /** Everything that loaded, merged and sorted as one list. */
  items: LibraryItem[];
  /** Kinds whose `list()` rejected. Never a reason to render nothing. */
  failed: LibraryKind[];
}

/**
 * Fan out across the enabled kinds and merge what comes back (PLAN-21).
 *
 * **`allSettled`, never `all`.** With three independent endpoints, `all` would
 * turn one flaky module into an empty page: the two kinds that answered would
 * be thrown away with the one that did not. A failed kind instead contributes
 * nothing to `items` and its name to `failed`, and the page shows the rest plus
 * a Retry strip naming what is missing.
 *
 * The fan-out is client-side on purpose. A server endpoint returning "all
 * documents" would have to read three modules' tables from one place, which
 * rule 2 forbids; the only legal shapes would be a core-owned aggregate table
 * or a bus-fed projection, and both couple storage that is deliberately
 * uncoupled. All three API clients already sit in `core/`, so this costs
 * nothing and the boundary stays intact.
 *
 * Scale bound, written down rather than discovered later: each list endpoint
 * returns its whole matching set (the client sends no `limit`, so each kind
 * comes back under the server's own 200-row default). That is fine for a
 * household tool holding tens to hundreds of documents. **If a library ever
 * reaches thousands of rows, merge-sorting in the browser is the thing that
 * breaks first**, and the fix is real cross-source pagination — a merge cursor
 * over three sorted streams — not a bigger fetch.
 *
 * Retrying one kind is the same call with one entry: `loadLibrary([entry], q)`.
 */
export async function loadLibrary(
  entries: readonly LibraryEntry[],
  query: LibraryQuery,
): Promise<LibraryLoad> {
  const settled = await Promise.allSettled(entries.map((entry) => entry.list(query)));

  const lists: LibraryItem[][] = [];
  const failed: LibraryKind[] = [];

  settled.forEach((result, index) => {
    const entry = entries[index];
    if (!entry) return;
    if (result.status === 'fulfilled') {
      lists.push(result.value);
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

  return { items: sortItems(mergeItems(lists), query.sort, query.order), failed };
}
