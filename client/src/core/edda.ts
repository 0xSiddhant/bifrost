import {
  ApiError,
  apiGet,
  apiSend,
  pagedParams,
  type DocumentListPage,
  type OffsetRequest,
} from './api';

export interface EddaConfig {
  /** Document size cap in KB — from .env via the server, never hardcoded. */
  maxDocKb: number;
  /** Above this size the live preview auto-degrades to manual refresh. */
  livePreviewMaxKb: number;
}

export const fetchEddaConfig = (): Promise<EddaConfig> => apiGet<EddaConfig>('/api/edda/config');

/** A saved document as the library lists it (no content). */
export interface EddaSummary {
  id: string;
  name: string;
  slug: string;
  authorDeviceId: string | null;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

export interface EddaDoc extends EddaSummary {
  content: string;
}

export type EddaSort = 'name' | 'created' | 'modified' | 'size';

export interface EddaListQuery {
  q?: string;
  /** Exact deviceId — the UI maps a picked author name back to its id. */
  author?: string;
  sort?: EddaSort;
  order?: 'asc' | 'desc';
}

function listParams(query: EddaListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.author) params.set('author', query.author);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  return params;
}

export function listEddas(query: EddaListQuery = {}): Promise<EddaSummary[]> {
  const qs = listParams(query).toString();
  return apiGet<EddaSummary[]>(`/api/edda${qs ? `?${qs}` : ''}`);
}

/** One page of the listing plus its total and author facet (PLAN-31). */
export function listEddasPage(
  query: EddaListQuery,
  request: OffsetRequest,
): Promise<DocumentListPage<EddaSummary>> {
  return apiGet<DocumentListPage<EddaSummary>>(
    `/api/edda?${pagedParams(listParams(query), request)}`,
  );
}

/**
 * Fetch by slug. The API 301s stale-name slugs to the canonical one and fetch
 * follows it transparently — compare `doc.slug` to fix the address bar.
 * Returns null on 404 (the creative not-written page).
 */
export async function fetchEdda(slug: string): Promise<EddaDoc | null> {
  try {
    return await apiGet<EddaDoc>(`/api/edda/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export const saveEdda = (input: { name?: string; content: string }): Promise<EddaDoc> =>
  apiSend<EddaDoc>('POST', '/api/edda', input);

export const updateEdda = (
  id: string,
  input: { name?: string; content?: string },
): Promise<EddaDoc> => apiSend<EddaDoc>('PUT', `/api/edda/${id}`, input);

export const deleteEdda = (id: string): Promise<null> => apiSend<null>('DELETE', `/api/edda/${id}`);
