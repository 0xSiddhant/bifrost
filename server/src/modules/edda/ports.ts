import type { EddaSummary } from '../../core/bus/events.js';

/** A full stored document — the listing summary plus its Markdown text. */
export interface EddaRecord extends EddaSummary {
  content: string;
}

export type EddaSort = 'name' | 'created' | 'modified' | 'size';

export interface EddaListFilter {
  /** Case-insensitive name substring — the server knows no author names. */
  q?: string;
  /** Exact device id (client maps a picked author name to its id). */
  authorDeviceId?: string;
  sort: EddaSort;
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/** DB access for saved eddas — usecases never touch Drizzle. */
export interface EddaRepository {
  insert(record: EddaRecord): void;
  update(record: EddaRecord): void;
  findById(id: string): EddaRecord | null;
  findBySlug(slug: string): EddaRecord | null;
  list(filter: EddaListFilter): EddaSummary[];
  /** Removes one document; returns it (for the deleted event) or null. */
  delete(id: string): EddaRecord | null;
  /** Every stored name — feeds the collision-safe default-name generator. */
  listNames(): string[];
  hasId(id: string): boolean;
}
