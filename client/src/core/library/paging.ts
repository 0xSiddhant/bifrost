import type { LibraryItem, LibraryKind, LibraryOrder, LibrarySort } from './types';

/**
 * Pure paging algebra for the Pensieve (PLAN-31). DOM-free, so the rules that
 * have to agree with four servers are plain unit tests.
 *
 * The Pensieve shows page k of a **merge** of four sorted streams, and no
 * server may compute that merge (rule 2: modules never read each other's
 * tables). So a page boundary is a vector of per-kind offsets, and a page is
 * built by asking every kind for `s` rows from its own offset and merging the
 * heads.
 */

/** Per-kind offsets — where a page starts in each kind's own sorted stream. */
export type Offsets = Partial<Record<LibraryKind, number>>;

/** SQLite's `lower()` folds ASCII only; so must we, or `É` sorts differently. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}

/**
 * Compare by Unicode code point — what SQLite's byte-wise UTF-8 comparison
 * amounts to. JavaScript's `<` compares UTF-16 code units, which disagrees for
 * characters above U+FFFF against those in U+E000–U+FFFF.
 */
export function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index]?.codePointAt(0) ?? 0) - (right[index]?.codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

const KEY: Record<LibrarySort, (a: LibraryItem, b: LibraryItem) => number> = {
  name: (a, b) => compareCodePoints(asciiLower(a.name), asciiLower(b.name)),
  created: (a, b) => a.createdAt - b.createdAt,
  modified: (a, b) => a.modifiedAt - b.modifiedAt,
  size: (a, b) => a.sizeBytes - b.sizeBytes,
};

/**
 * The merge order: `(key, id, kind)`, **every** component in the requested
 * direction. That mirrors the paged servers, which break ties on `id` in the
 * sort direction too, and it is what makes the reversed order the exact
 * mirror — the last page is computed by merging the reversed streams.
 * `kind` is last because ids are only unique within a kind.
 */
export function compareItems(
  a: LibraryItem,
  b: LibraryItem,
  sort: LibrarySort,
  order: LibraryOrder,
): number {
  const direction = order === 'asc' ? 1 : -1;
  const primary = KEY[sort](a, b);
  if (primary !== 0) return Math.sign(primary) * direction;
  const byId = compareCodePoints(a.id, b.id);
  if (byId !== 0) return Math.sign(byId) * direction;
  return Math.sign(compareCodePoints(a.kind, b.kind)) * direction;
}

export interface Stream {
  kind: LibraryKind;
  /** Rows in the order the kind's own server returned them. */
  rows: readonly LibraryItem[];
}

export interface Merged {
  rows: LibraryItem[];
  /** How many rows the merge took from each stream — the next boundary's delta. */
  consumed: Offsets;
}

/**
 * Take the first `take` rows of a k-way merge of the streams' **heads**.
 *
 * ⚠️ Never "concatenate and sort". The comparator can disagree with SQLite on
 * some strings, and a head merge only ever lets that change how two *kinds*
 * interleave: each stream is consumed strictly in its server's order, so the
 * per-kind counts — the offsets the next page starts from — stay exact. A
 * concat-and-sort could reorder rows *within* a kind and silently skip or
 * repeat one on the next page.
 */
export function mergeHeads(
  streams: readonly Stream[],
  take: number,
  compare: (a: LibraryItem, b: LibraryItem) => number,
): Merged {
  const cursor = streams.map(() => 0);
  const rows: LibraryItem[] = [];
  const consumed: Offsets = {};
  for (const stream of streams) consumed[stream.kind] = 0;

  while (rows.length < take) {
    let best = -1;
    for (let index = 0; index < streams.length; index += 1) {
      const head = streams[index]?.rows[cursor[index] ?? 0];
      if (!head) continue;
      const current = best === -1 ? undefined : streams[best]?.rows[cursor[best] ?? 0];
      if (!current || compare(head, current) < 0) best = index;
    }
    if (best === -1) break;
    const stream = streams[best];
    const head = stream?.rows[cursor[best] ?? 0];
    if (!stream || !head) break;
    rows.push(head);
    cursor[best] = (cursor[best] ?? 0) + 1;
    consumed[stream.kind] = (consumed[stream.kind] ?? 0) + 1;
  }
  return { rows, consumed };
}

/** Number of pages for `total` rows at `size` per page; never less than 1. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / Math.max(size, 1)));
}

export type PageSlot = number | 'gap';

/**
 * The pager's window: first, last, current ±1, and a gap wherever numbers are
 * skipped. With the prev/next arrows that is never more than nine controls,
 * and every number offered is at most one walk step from a known boundary.
 */
export function pageWindow(current: number, count: number): PageSlot[] {
  if (count <= 1) return [1];
  const pages = new Set([1, count, current - 1, current, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= count).sort((a, b) => a - b);
  const slots: PageSlot[] = [];
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && page - previous > 1) slots.push('gap');
    slots.push(page);
  });
  return slots;
}

/** Read `?page=`: anything but a positive integer is page 1. */
export function parsePageParam(raw: string | null): number {
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

export const flipOrder = (order: LibraryOrder): LibraryOrder => (order === 'asc' ? 'desc' : 'asc');
