import type { Portkey } from '../../core/bus/events.js';

export type { Portkey };

export interface PortkeyListFilter {
  /** Case-insensitive substring; matches slug, url AND note. */
  q?: string;
  limit: number;
  offset: number;
}

/** DB access for the go-links table — usecases never touch Drizzle. */
export interface PortkeyRepository {
  insert(portkey: Portkey): void;
  /** Patches url/note of an existing row (slug is immutable); returns the new row or null. */
  update(slug: string, patch: { url: string; note: string | null }): Portkey | null;
  findBySlug(slug: string): Portkey | null;
  list(filter: PortkeyListFilter): Portkey[];
  /** Removes one link; returns it (for the deleted event) or null. */
  delete(slug: string): Portkey | null;
  hasSlug(slug: string): boolean;
  /**
   * Records a redirect: `hits += 1`, `last_used_at = at`. Called off the hot
   * path (after the 302 is sent) so it never delays the hop. Returns the updated
   * row (for the live SSE hit event) or null if it was deleted meanwhile.
   */
  recordHit(slug: string, at: number): Portkey | null;
}
