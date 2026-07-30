import { apiGet, apiSend } from '../../core/api';

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

export function listPortkeys(q?: string): Promise<Portkey[]> {
  const params = new URLSearchParams({ limit: '1000' });
  if (q) params.set('q', q);
  return apiGet<Portkey[]>(`/api/portkey?${params.toString()}`);
}

/** Throws ApiError 422 (bad slug/target), 409 (slug taken). */
export const createPortkey = (input: { slug: string; url: string; note?: string }): Promise<Portkey> =>
  apiSend<Portkey>('POST', '/api/portkey', input);

/** Slug is immutable — only url/note can change. */
export const updatePortkey = (
  slug: string,
  input: { url?: string; note?: string },
): Promise<Portkey> => apiSend<Portkey>('PATCH', `/api/portkey/${encodeURIComponent(slug)}`, input);

export const deletePortkey = (slug: string): Promise<null> =>
  apiSend<null>('DELETE', `/api/portkey/${encodeURIComponent(slug)}`);

/** The absolute address a QR encodes / a person types: this origin + /go/<slug>. */
export const goUrl = (slug: string): string => `${window.location.origin}/go/${slug}`;
/** The path form shown inline in the UI. */
export const goPath = (slug: string): string => `/go/${slug}`;
