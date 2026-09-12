import { ApiError, apiGet, apiSend } from './api';

export interface GrootConfig {
  /** Document size cap in KB — from .env via the server, never hardcoded. */
  maxDocKb: number;
}

export const fetchGrootConfig = (): Promise<GrootConfig> => apiGet<GrootConfig>('/api/groot/config');

/** A saved document as the Pensieve lists it (no content). */
export interface GrootSummary {
  id: string;
  name: string;
  slug: string;
  authorDeviceId: string | null;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

export interface GrootDoc extends GrootSummary {
  content: string;
}

export type GrootSort = 'name' | 'created' | 'modified' | 'size';

export interface GrootListQuery {
  q?: string;
  /** Exact deviceId — the UI maps a picked author name back to its id. */
  author?: string;
  sort?: GrootSort;
  order?: 'asc' | 'desc';
}

export function listGroots(query: GrootListQuery = {}): Promise<GrootSummary[]> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.author) params.set('author', query.author);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  const qs = params.toString();
  return apiGet<GrootSummary[]>(`/api/groot${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch by slug. The API 301s stale-name slugs to the canonical one and fetch
 * follows it transparently — compare `doc.slug` to fix the address bar.
 * Returns null on 404 (the creative not-grown page).
 */
export async function fetchGroot(slug: string): Promise<GrootDoc | null> {
  try {
    return await apiGet<GrootDoc>(`/api/groot/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export const saveGroot = (input: { name?: string; content: string }): Promise<GrootDoc> =>
  apiSend<GrootDoc>('POST', '/api/groot', input);

export const updateGroot = (
  id: string,
  input: { name?: string; content?: string },
): Promise<GrootDoc> => apiSend<GrootDoc>('PUT', `/api/groot/${id}`, input);

export const deleteGroot = (id: string): Promise<null> =>
  apiSend<null>('DELETE', `/api/groot/${id}`);
