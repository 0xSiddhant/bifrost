import {
  ApiError,
  apiGet,
  apiSend,
  hubOnly,
  pagedParams,
  type DocumentListPage,
  type OffsetRequest,
} from './api';

export interface GrootConfig {
  /** Document size cap in KB — the server's own .env value, baked in at build time. */
  maxDocKb: number;
}

/**
 * The size cap, baked in at build time from the same `.env` key the server
 * enforces on save (PLAN-35): one number, so the client never allows what the
 * server refuses. A changed cap needs a client rebuild; the server's boot log
 * names any drift.
 */
export const GROOT_CONFIG: GrootConfig = {
  maxDocKb: __BIFROST_DEFAULTS__.caps.grootMaxDocKb,
};

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

function listParams(query: GrootListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.author) params.set('author', query.author);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  return params;
}

function hubListGroots(query: GrootListQuery = {}): Promise<GrootSummary[]> {
  const qs = listParams(query).toString();
  return apiGet<GrootSummary[]>(`/api/groot${qs ? `?${qs}` : ''}`);
}

/** One page of the listing plus its total and author facet (PLAN-31). */
function hubListGrootsPage(
  query: GrootListQuery,
  request: OffsetRequest,
): Promise<DocumentListPage<GrootSummary>> {
  return apiGet<DocumentListPage<GrootSummary>>(
    `/api/groot?${pagedParams(listParams(query), request)}`,
  );
}

/**
 * Fetch by slug. The API 301s stale-name slugs to the canonical one and fetch
 * follows it transparently — compare `doc.slug` to fix the address bar.
 * Returns null on 404 (the creative not-grown page).
 */
async function hubFetchGroot(slug: string): Promise<GrootDoc | null> {
  try {
    return await apiGet<GrootDoc>(`/api/groot/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

const hubSaveGroot = (input: { name?: string; content: string }): Promise<GrootDoc> =>
  apiSend<GrootDoc>('POST', '/api/groot', input);

const hubUpdateGroot = (
  id: string,
  input: { name?: string; content?: string },
): Promise<GrootDoc> => apiSend<GrootDoc>('PUT', `/api/groot/${id}`, input);

const hubDeleteGroot = (id: string): Promise<null> => apiSend<null>('DELETE', `/api/groot/${id}`);

/*
 * The hub's document API. On the standalone site each is a stub that throws
 * HubUnavailableError and opens the Bifröst sheet, with no request (PLAN-35).
 */
export const listGroots: typeof hubListGroots = __HUB__ ? hubListGroots : hubOnly('listGroots');
export const listGrootsPage: typeof hubListGrootsPage = __HUB__
  ? hubListGrootsPage
  : hubOnly('listGrootsPage');
export const fetchGroot: typeof hubFetchGroot = __HUB__ ? hubFetchGroot : hubOnly('fetchGroot');
export const saveGroot: typeof hubSaveGroot = __HUB__ ? hubSaveGroot : hubOnly('saveGroot');
export const updateGroot: typeof hubUpdateGroot = __HUB__ ? hubUpdateGroot : hubOnly('updateGroot');
export const deleteGroot: typeof hubDeleteGroot = __HUB__ ? hubDeleteGroot : hubOnly('deleteGroot');
