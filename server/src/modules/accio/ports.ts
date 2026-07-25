import type { AccioLink } from '../../core/bus/events.js';

export type { AccioLink };

export type AccioSort = 'created' | 'title' | 'url';

export interface AccioListFilter {
  /** Case-insensitive substring; matches title **and** url (plan: search composes with tag). */
  q?: string;
  /** Exact tag (already normalized by the usecase). */
  tag?: string;
  sort: AccioSort;
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/** DB access for the shelf — usecases never touch Drizzle. */
export interface AccioRepository {
  insert(link: AccioLink): void;
  update(link: AccioLink): void;
  findById(id: string): AccioLink | null;
  list(filter: AccioListFilter): AccioLink[];
  /** Removes one link; returns it (for the deleted event) or null. */
  delete(id: string): AccioLink | null;
  hasId(id: string): boolean;
}

/**
 * Best-effort page-title lookup. An interface because the usecase may not know
 * the network exists (coding rule: usecases import ports, never fetch) — and
 * because "the site is unreachable" is the normal case on a LAN with no
 * internet, which tests must be able to reproduce without one.
 */
export interface TitleFetcher {
  /** The page's title, or null on timeout, non-HTML, error, or no title. */
  fetchTitle(url: string): Promise<string | null>;
}
