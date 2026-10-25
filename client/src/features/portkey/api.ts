import { API_V1, apiGet, apiSend, type CursorListPage } from '../../core/api';

/**
 * Portkey (LAN go-links) API client. Feature-local — nothing outside this
 * feature needs it (unlike the read-later shelf, which Hermes also calls).
 */

export interface Portkey {
  /** User-chosen memorable word; the immutable identity of the link. */
  slug: string;
  /** Normalized absolute http(s) target — the server owns normalization. */
  url: string;
  note: string | null;
  hits: number;
  authorDeviceId: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/**
 * One batch of go-links, newest first (PLAN-31). `cursor` null = the first
 * batch; the server searches slug, target and note, and picks the page size
 * (LIST_PAGE_SIZE) unless `limit` asks for fewer — the re-count asks for one.
 */
export function listPortkeysPage(
  q: string | undefined,
  cursor: string | null,
  options: { signal?: AbortSignal; limit?: number } = {},
): Promise<CursorListPage<Portkey>> {
  const params = new URLSearchParams({ paged: 'true' });
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  return apiGet<CursorListPage<Portkey>>(`${API_V1}/portkey?${params.toString()}`, {
    signal: options.signal,
  });
}

/** Throws ApiError 422 (bad slug/target), 409 (slug taken). */
export const createPortkey = (input: {
  slug: string;
  url: string;
  note?: string;
}): Promise<Portkey> => apiSend<Portkey>('POST', `${API_V1}/portkey`, input);

/** Slug is immutable — only url/note can change. */
export const updatePortkey = (
  slug: string,
  input: { url?: string; note?: string },
): Promise<Portkey> =>
  apiSend<Portkey>('PATCH', `${API_V1}/portkey/${encodeURIComponent(slug)}`, input);

export const deletePortkey = (slug: string): Promise<null> =>
  apiSend<null>('DELETE', `${API_V1}/portkey/${encodeURIComponent(slug)}`);

/** The absolute address a QR encodes / a person types: this origin + /go/<slug>. */
export const goUrl = (slug: string): string => `${window.location.origin}/go/${slug}`;
/** The path form shown inline in the UI. */
export const goPath = (slug: string): string => `/go/${slug}`;
