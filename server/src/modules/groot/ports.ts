import type { GrootSummary } from '../../core/bus/events.js';

/** A full stored document — the listing summary plus its YAML text. */
export interface GrootRecord extends GrootSummary {
  content: string;
}

export type GrootSort = 'name' | 'created' | 'modified' | 'size';

export interface GrootListFilter {
  /** Case-insensitive name substring — the server knows no author names. */
  q?: string;
  /** Exact device id (client maps a picked author name to its id). */
  authorDeviceId?: string;
  sort: GrootSort;
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/** DB access for saved groots — usecases never touch Drizzle. */
export interface GrootRepository {
  insert(record: GrootRecord): void;
  update(record: GrootRecord): void;
  findById(id: string): GrootRecord | null;
  findBySlug(slug: string): GrootRecord | null;
  list(filter: GrootListFilter): GrootSummary[];
  /** Removes one document; returns it (for the deleted event) or null. */
  delete(id: string): GrootRecord | null;
  /** Every stored name — feeds the collision-safe default-name generator. */
  listNames(): string[];
  hasId(id: string): boolean;
}
