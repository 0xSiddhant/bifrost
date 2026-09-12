import type { AtlasSummary } from '../../core/bus/events.js';

/** A full stored document — the listing summary plus its XML text. */
export interface AtlasRecord extends AtlasSummary {
  content: string;
}

export type AtlasSort = 'name' | 'created' | 'modified' | 'size';

export interface AtlasListFilter {
  /** Case-insensitive name substring — the server knows no author names. */
  q?: string;
  /** Exact device id (client maps a picked author name to its id). */
  authorDeviceId?: string;
  sort: AtlasSort;
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/** DB access for saved XML documents — usecases never touch Drizzle. */
export interface AtlasRepository {
  insert(record: AtlasRecord): void;
  update(record: AtlasRecord): void;
  findById(id: string): AtlasRecord | null;
  findBySlug(slug: string): AtlasRecord | null;
  list(filter: AtlasListFilter): AtlasSummary[];
  /** Removes one document; returns it (for the deleted event) or null. */
  delete(id: string): AtlasRecord | null;
  /** Every stored name — feeds the collision-safe default-name generator. */
  listNames(): string[];
  hasId(id: string): boolean;
}
