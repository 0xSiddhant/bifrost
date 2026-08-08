import type { LibraryItem, LibraryKind, LibraryOrder, LibrarySort } from './types';

/**
 * Pure list algebra for the Pensieve (PLAN-21). Kept out of the page so the
 * ordering rules that have to agree with three servers can be unit-tested
 * without a DOM — and so a fourth kind inherits them for free.
 */

/** Match the server's `lower(name)` ordering rather than a locale collation. */
function byName(a: LibraryItem, b: LibraryItem): number {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const COMPARE: Record<LibrarySort, (a: LibraryItem, b: LibraryItem) => number> = {
  name: byName,
  created: (a, b) => a.createdAt - b.createdAt,
  modified: (a, b) => a.modifiedAt - b.modifiedAt,
  size: (a, b) => a.sizeBytes - b.sizeBytes,
};

/**
 * Sort a merged list the way each individual server sorted its own.
 *
 * The tiebreak is `id` then `kind`, mirroring the repositories' `asc(id)`
 * secondary key. It matters more here than it does there: ids are only unique
 * within a table, so two kinds can hold the same handle, and without the second
 * tiebreak two documents with equal keys could swap places between renders.
 */
export function sortItems(
  items: readonly LibraryItem[],
  sort: LibrarySort,
  order: LibraryOrder,
): LibraryItem[] {
  const direction = order === 'asc' ? 1 : -1;
  const compare = COMPARE[sort];
  return [...items].sort((a, b) => {
    const primary = compare(a, b);
    if (primary !== 0) return primary * direction;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
}

/** Flatten per-kind results into one list, in registry order before sorting. */
export function mergeItems(lists: readonly (readonly LibraryItem[])[]): LibraryItem[] {
  return lists.flat();
}

export interface LibraryFilter {
  /** Case-insensitive substring of the name, as SQLite's `LIKE` matches it. */
  q?: string;
  /** Exact deviceId. */
  author?: string;
  /** null = every kind. */
  kind?: LibraryKind | null;
}

/**
 * Apply the filters locally.
 *
 * `q` and `author` are also sent to each server, so re-applying them here is
 * deliberately redundant: it keeps the three sources honest against one rule,
 * and it is what lets an SSE-driven refresh narrow a list it already holds
 * without three round trips. `kind` has no server to ask — no endpoint knows
 * the other kinds exist — so this is the only place the type chip is applied.
 */
export function filterItems(
  items: readonly LibraryItem[],
  filter: LibraryFilter,
): LibraryItem[] {
  const needle = filter.q?.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.kind && item.kind !== filter.kind) return false;
    if (filter.author && item.authorDeviceId !== filter.author) return false;
    if (needle && !item.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}
