import { ApiError, apiGet, apiSend } from './api';

export interface AtlasConfig {
  /** Document size cap in KB — from .env via the server, never hardcoded. */
  maxDocKb: number;
}

export const fetchAtlasConfig = (): Promise<AtlasConfig> => apiGet<AtlasConfig>('/api/atlas/config');

/** A saved document as the Pensieve lists it (no content). */
export interface AtlasSummary {
  id: string;
  name: string;
  slug: string;
  authorDeviceId: string | null;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

export interface AtlasDoc extends AtlasSummary {
  content: string;
}

export type AtlasSort = 'name' | 'created' | 'modified' | 'size';

export interface AtlasListQuery {
  q?: string;
  /** Exact deviceId — the UI maps a picked author name back to its id. */
  author?: string;
  sort?: AtlasSort;
  order?: 'asc' | 'desc';
}

export function listAtlases(query: AtlasListQuery = {}): Promise<AtlasSummary[]> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.author) params.set('author', query.author);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  const qs = params.toString();
  return apiGet<AtlasSummary[]>(`/api/atlas${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch by slug. The API 301s stale-name slugs to the canonical one and fetch
 * follows it transparently — compare `doc.slug` to fix the address bar.
 * Returns null on 404 (the creative not-grown page).
 */
export async function fetchAtlas(slug: string): Promise<AtlasDoc | null> {
  try {
    return await apiGet<AtlasDoc>(`/api/atlas/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export const saveAtlas = (input: { name?: string; content: string }): Promise<AtlasDoc> =>
  apiSend<AtlasDoc>('POST', '/api/atlas', input);

export const updateAtlas = (
  id: string,
  input: { name?: string; content?: string },
): Promise<AtlasDoc> => apiSend<AtlasDoc>('PUT', `/api/atlas/${id}`, input);

export const deleteAtlas = (id: string): Promise<null> =>
  apiSend<null>('DELETE', `/api/atlas/${id}`);
