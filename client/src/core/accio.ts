import { apiGet, apiSend, type CursorListPage } from './api';

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
}

/** Accio's paged envelope: a cursor page plus every tag on the whole shelf. */
export interface AccioListPage extends CursorListPage<AccioLink> {
  tags: string[];
}

/**
 * One batch of the shelf (PLAN-31). `cursor` null = the first batch; the
 * server owns search, tag filter and sort, and the page size (LIST_PAGE_SIZE)
 * unless `limit` asks for fewer — the re-count asks for one.
 */
export function listLinksPage(
  query: AccioListQuery,
  cursor: string | null,
  options: { signal?: AbortSignal; limit?: number } = {},
): Promise<AccioListPage> {
  const params = new URLSearchParams({ paged: 'true' });
  if (query.q) params.set('q', query.q);
  if (query.tag) params.set('tag', query.tag);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  if (cursor) params.set('cursor', cursor);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  return apiGet<AccioListPage>(`/api/accio?${params.toString()}`, { signal: options.signal });
}

/**
 * Saves a link. Resolves as soon as the row exists — the title, when the client
 * didn't supply one, arrives later as an `accio.updated` SSE event.
 * Throws ApiError 422 when the URL isn't a supported http(s) address.
 */
export const saveLink = (input: {
  url: string;
  title?: string;
  tags?: string[];
}): Promise<AccioLink> => apiSend<AccioLink>('POST', '/api/accio', input);

export const updateLink = (
  id: string,
  input: { title?: string; tags?: string[] },
): Promise<AccioLink> => apiSend<AccioLink>('PATCH', `/api/accio/${id}`, input);

export const deleteLink = (id: string): Promise<null> =>
  apiSend<null>('DELETE', `/api/accio/${id}`);
