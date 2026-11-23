import type { RunestoneFormat, RunestoneSummary } from '../../core/bus/events.js';

export type { RunestoneFormat };

/** A full stored document — the listing summary plus its JSON text. */
export interface RunestoneRecord extends RunestoneSummary {
  content: string;
}

export type RunestoneSort = 'name' | 'created' | 'modified' | 'size';

export interface RunestoneListFilter {
  /** Case-insensitive name substring — the server knows no author names. */
  q?: string;
  /** Exact device id (client maps a picked author name to its id). */
  authorDeviceId?: string;
  /** Only documents in this format (PLAN-42); absent means both. */
  format?: RunestoneFormat;
  sort: RunestoneSort;
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/** DB access for saved runestones — usecases never touch Drizzle. */
export interface RunestoneRepository {
  insert(record: RunestoneRecord): void;
  update(record: RunestoneRecord): void;
  findById(id: string): RunestoneRecord | null;
  findBySlug(slug: string): RunestoneRecord | null;
  list(filter: RunestoneListFilter): RunestoneSummary[];
  /**
   * The paged form (PLAN-31): ordered by `(sortKey, id)` **both** in the
   * filter's direction, so `asc` and `desc` are exact mirrors even across ties
   * — the Pensieve computes its last page by reading the reversed order.
   * `list` keeps its `asc(id)` tiebreak for the legacy array response.
   */
  listPage(filter: RunestoneListFilter): RunestoneSummary[];
  /** Rows matching `q`/`authorDeviceId`/`format`, ignoring sort and paging. */
  count(filter: Pick<RunestoneListFilter, 'q' | 'authorDeviceId' | 'format'>): number;
  /** Every distinct author over the whole table, unfiltered — the dropdown's options. */
  listAuthors(): string[];
  /** Removes one document; returns it (for the deleted event) or null. */
  delete(id: string): RunestoneRecord | null;
  /** Every stored name — feeds the collision-safe default-name generator. */
  listNames(): string[];
  hasId(id: string): boolean;
}
