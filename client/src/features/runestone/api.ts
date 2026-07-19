import { ApiError, apiGet, apiSend } from '../../core/api';

export interface RunestoneConfig {
  /** Document size cap in KB — from .env via the server, never hardcoded. */
  maxDocKb: number;
}

export const fetchRunestoneConfig = (): Promise<RunestoneConfig> =>
  apiGet<RunestoneConfig>('/api/runestone/config');

/** A saved document as the library lists it (no content). */
export interface RunestoneSummary {
  id: string;
  name: string;
  slug: string;
  authorDeviceId: string | null;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

export interface RunestoneDoc extends RunestoneSummary {
  content: string;
}

export type RunestoneSort = 'name' | 'created' | 'modified' | 'size';

export interface RunestoneListQuery {
  q?: string;
  /** Exact deviceId — the UI maps a picked author name back to its id. */
  author?: string;
  sort?: RunestoneSort;
  order?: 'asc' | 'desc';
}

export function listRunestones(query: RunestoneListQuery = {}): Promise<RunestoneSummary[]> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.author) params.set('author', query.author);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  const qs = params.toString();
  return apiGet<RunestoneSummary[]>(`/api/runestone${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch by slug. The API 301s stale-name slugs to the canonical one and fetch
 * follows it transparently — compare `doc.slug` to fix the address bar.
 * Returns null on 404 (the creative not-carved page).
 */
export async function fetchRunestone(slug: string): Promise<RunestoneDoc | null> {
  try {
    return await apiGet<RunestoneDoc>(`/api/runestone/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export const saveRunestone = (input: { name?: string; content: string }): Promise<RunestoneDoc> =>
  apiSend<RunestoneDoc>('POST', '/api/runestone', input);

export const updateRunestone = (
  id: string,
  input: { name?: string; content?: string },
): Promise<RunestoneDoc> => apiSend<RunestoneDoc>('PUT', `/api/runestone/${id}`, input);

export const deleteRunestone = (id: string): Promise<null> =>
  apiSend<null>('DELETE', `/api/runestone/${id}`);
