import { apiGet, apiSend } from './api';

/**
 * Accio (read-later shelf) API client. Lives in `core/` rather than
 * `features/accio/` because Hermes' "Accio it" action needs it too and features
 * may never import each other (coding rules → boundaries).
 */

export interface AccioLink {
  id: string;
  /** Normalized absolute http(s) URL — the server owns normalization. */
  url: string;
  /** Best-effort page title; null means "show the bare URL". */
  title: string | null;
  tags: string[];
  authorDeviceId: string | null;
  createdAt: number;
}

export interface AccioListQuery {
  q?: string;
  tag?: string;
  sort?: 'created' | 'title' | 'url';
  order?: 'asc' | 'desc';
  limit?: number;
}

export function listLinks(query: AccioListQuery = {}): Promise<AccioLink[]> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.tag) params.set('tag', query.tag);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return apiGet<AccioLink[]>(`/api/accio${qs ? `?${qs}` : ''}`);
}

/**
 * Saves a link. Resolves as soon as the row exists — the title, when the client
 * didn't supply one, arrives later as an `accio.updated` SSE event.
 * Throws ApiError 422 when the URL isn't a supported http(s) address.
 */
export const saveLink = (input: { url: string; title?: string; tags?: string[] }): Promise<AccioLink> =>
  apiSend<AccioLink>('POST', '/api/accio', input);

export const updateLink = (
  id: string,
  input: { title?: string; tags?: string[] },
): Promise<AccioLink> => apiSend<AccioLink>('PATCH', `/api/accio/${id}`, input);

export const deleteLink = (id: string): Promise<null> => apiSend<null>('DELETE', `/api/accio/${id}`);
