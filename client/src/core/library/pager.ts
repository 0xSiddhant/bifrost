import { loadLibraryStep, type LibraryStep } from './load';
import { flipOrder, pageCount, type Offsets } from './paging';
import type { LibraryEntry, LibraryItem, LibraryKind, LibraryQuery } from './types';

export interface LibraryPageView {
  rows: LibraryItem[];
  /** The page actually shown — a requested page past the end is clamped. */
  page: number;
  pageCount: number;
  /** Documents matching the query, over every kind that answered. */
  total: number;
  /** 1-based position of the first and last row shown; 0 when empty. */
  from: number;
  to: number;
  /** Union of the answering kinds' unfiltered author facets. */
  authors: string[];
  /** Kinds that failed while building this view. */
  failed: LibraryKind[];
}

/**
 * Thrown inside a walk that `invalidate()` overtook: its captured boundaries
 * belong to a list that no longer exists, so `page()` starts it over rather
 * than finish it on stale offsets or write them back into the fresh cache.
 */
class StaleWalk extends Error {}

/** A walk that keeps being overtaken by live changes gives up after this many. */
const MAX_WALK_ATTEMPTS = 5;

const add = (a: Offsets, b: Offsets, sign: 1 | -1): Offsets => {
  const next: Offsets = { ...a };
  for (const [kind, delta] of Object.entries(b) as Array<[LibraryKind, number]>) {
    next[kind] = (next[kind] ?? 0) + sign * delta;
  }
  return next;
};

/**
 * Walks the Pensieve's merged, paged list (PLAN-31). One instance per query
 * and kind set: a filter change makes a new one.
 *
 * It keeps a cache of **known boundaries** — the per-kind offsets where page p
 * starts. Page 1 always starts at zero. Every forward step learns where the
 * next page starts; every backward step learns where the previous one did. The
 * end of the list is known too — it is every kind's total — so the last page
 * is one backward step: merge the kinds in the reversed order, take the last
 * page's `r` rows, and reverse them. Reaching page k walks from whichever known
 * boundary is nearer, one step (four parallel small requests) at a time.
 *
 * Exactness rests on the streams not changing mid-walk. Every change arrives
 * as an SSE event, and the page calls `invalidate()` on each one, so an
 * off-by-one boundary lives only until that event is handled.
 */
export class LibraryPager {
  private readonly starts = new Map<number, Offsets>();
  private totals: Offsets | null = null;
  private size: number | null = null;
  private authors: string[] = [];
  private active: LibraryEntry[];
  private readonly failed: LibraryKind[] = [];
  /** Bumped by `invalidate()`; a walk that sees it move is stale. */
  private epoch = 0;

  constructor(
    entries: readonly LibraryEntry[],
    private readonly query: LibraryQuery,
  ) {
    this.active = [...entries];
  }

  /** Forget every boundary; the next `page()` starts again from page 1. */
  invalidate(): void {
    this.starts.clear();
    this.totals = null;
    this.epoch += 1;
  }

  /** Build page `target` (clamped to the real range). */
  async page(target: number): Promise<LibraryPageView> {
    // A kind that fails mid-walk leaves every cached boundary counting rows
    // from a merge it is no longer part of, so the walk restarts without it.
    // Bounded: each restart removes at least one kind.
    //
    // A live change can also land mid-walk (the page calls `invalidate()` from
    // an SSE handler while a walk is awaiting); that walk is abandoned and
    // rebuilt from the fresh state instead of painting rows from old offsets.
    for (let attempt = 1; ; attempt += 1) {
      const failedBefore = this.failed.length;
      try {
        const { rows, page } = await this.build(target);
        if (this.failed.length === failedBefore || this.active.length === 0) {
          return this.view(rows, page);
        }
        this.invalidate();
      } catch (error) {
        if (!(error instanceof StaleWalk) || attempt >= MAX_WALK_ATTEMPTS) throw error;
      }
    }
  }

  /**
   * After this device's own delete on `current`: that page's start is still
   * exact (the deleted row sat after it), so it refetches in place; every later
   * boundary is dropped. An emptied last page steps back to the new last page.
   */
  async refreshAfterDelete(current: number): Promise<LibraryPageView> {
    for (const page of [...this.starts.keys()]) if (page > current) this.starts.delete(page);
    if (!this.starts.has(current) || this.size === null) return this.page(current);
    try {
      const rows = await this.forward(current);
      if (rows.length === 0 && current > 1) return this.page(this.count);
      return this.view(rows, current);
    } catch (error) {
      // Overtaken by a live change: rebuild the same page from scratch.
      if (error instanceof StaleWalk) return this.page(current);
      throw error;
    }
  }

  private get total(): number {
    return this.active.reduce((sum, entry) => sum + (this.totals?.[entry.kind] ?? 0), 0);
  }

  private get count(): number {
    return pageCount(this.total, this.size ?? 1);
  }

  private endOffsets(): Offsets {
    const end: Offsets = {};
    for (const entry of this.active) end[entry.kind] = this.totals?.[entry.kind] ?? 0;
    return end;
  }

  private async build(target: number): Promise<{ rows: LibraryItem[]; page: number }> {
    if (this.totals === null || this.size === null) {
      // Cold start: the page-1 request is also what reveals the totals, and
      // with them the page count and which end is nearer.
      this.starts.set(1, {});
      const rows = await this.forward(1);
      if (Math.min(Math.max(target, 1), this.count) === 1) return { rows, page: 1 };
    }
    const size = this.size ?? 1;
    const k = Math.min(Math.max(target, 1), this.count);

    // One kind needs no merge: page k is simply offset (k−1)·s.
    const sole = this.active.length === 1 ? this.active[0] : undefined;
    if (sole) {
      this.starts.set(k, { [sole.kind]: (k - 1) * size });
      return { rows: await this.forward(k), page: k };
    }
    if (this.starts.has(k)) return { rows: await this.forward(k), page: k };

    const known = [...this.starts.keys()];
    const below = Math.max(...known.filter((page) => page < k), 1);
    const above = Math.min(...known.filter((page) => page > k), this.count + 1);
    const forwardSteps = k - below + 1;
    const backwardSteps = above - k;

    if (forwardSteps <= backwardSteps) {
      for (let page = below; page < k; page += 1) await this.forward(page);
      return { rows: await this.forward(k), page: k };
    }
    for (let page = above - 1; page > k; page -= 1) await this.backward(page);
    return { rows: await this.backward(k), page: k };
  }

  /** Page p from its known start; learns where page p+1 starts. */
  private async forward(page: number): Promise<LibraryItem[]> {
    const start = this.starts.get(page);
    if (!start) throw new StaleWalk();
    const result = await this.step(start, this.size ?? undefined, false);
    this.starts.set(page + 1, add(start, result.consumed, 1));
    return result.rows;
  }

  /** Page p from where page p+1 starts (or the end); learns where page p starts. */
  private async backward(page: number): Promise<LibraryItem[]> {
    const size = this.size ?? 1;
    const count = this.count;
    const end = page === count ? this.endOffsets() : this.starts.get(page + 1);
    if (!end) return this.forwardFromOne(page);
    // Offsets counted from the end, which is what the reversed stream reads from.
    const fromEnd: Offsets = {};
    for (const entry of this.active) {
      fromEnd[entry.kind] = (this.totals?.[entry.kind] ?? 0) - (end[entry.kind] ?? 0);
    }
    const take = page === count ? this.total - (count - 1) * size : size;
    const result = await this.step(fromEnd, Math.max(take, 1), true);
    this.starts.set(page, add(end, result.consumed, -1));
    return [...result.rows].reverse();
  }

  /** Defensive fallback: should a boundary ever be missing, walk from page 1. */
  private async forwardFromOne(page: number): Promise<LibraryItem[]> {
    this.starts.set(1, {});
    for (let step = 1; step < page; step += 1) await this.forward(step);
    return this.forward(page);
  }

  private async step(
    offsets: Offsets,
    take: number | undefined,
    reversed: boolean,
  ): Promise<LibraryStep> {
    const query = reversed ? { ...this.query, order: flipOrder(this.query.order) } : this.query;
    const epoch = this.epoch;
    const result = await loadLibraryStep(this.active, query, offsets, take);
    // Nothing a stale step learned may reach the fresh cache.
    if (epoch !== this.epoch) throw new StaleWalk();
    if (result.failed.length > 0) {
      this.failed.push(...result.failed);
      this.active = this.active.filter((entry) => !result.failed.includes(entry.kind));
    }
    // Only a request that named no limit reveals LIST_PAGE_SIZE; the last page
    // asks for exactly its own `r` rows and would echo that back instead.
    if (take === undefined && result.limit !== null) this.size = result.limit;
    this.totals = { ...(this.totals ?? {}), ...result.totals };
    if (Object.keys(result.totals).length > 0) this.authors = result.authors;
    return result;
  }

  private view(rows: LibraryItem[], page: number): LibraryPageView {
    const size = this.size ?? rows.length;
    const from = rows.length > 0 ? (page - 1) * size + 1 : 0;
    return {
      rows,
      page,
      pageCount: this.count,
      total: this.total,
      from,
      to: rows.length > 0 ? from + rows.length - 1 : 0,
      authors: this.authors,
      failed: [...this.failed],
    };
  }
}
