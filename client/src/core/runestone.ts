import {
  API_V1,
  ApiError,
  apiGet,
  apiSend,
  hubOnly,
  pagedParams,
  type DocumentListPage,
  type OffsetRequest,
} from './api';

export interface RunestoneConfig {
  /** Document size cap in KB — the server's own .env value, baked in at build time. */
  maxDocKb: number;
}

/**
 * The size cap, baked in at build time from the same `.env` key the server
 * enforces on save (PLAN-35): one number, so the client never allows what the
 * server refuses. A changed cap needs a client rebuild; the server's boot log
 * names any drift.
 */
export const RUNESTONE_CONFIG: RunestoneConfig = {
  maxDocKb: __BIFROST_DEFAULTS__.caps.runestoneMaxDocKb,
};

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

function listParams(query: RunestoneListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.author) params.set('author', query.author);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  return params;
}

function hubListRunestones(query: RunestoneListQuery = {}): Promise<RunestoneSummary[]> {
  const qs = listParams(query).toString();
  return apiGet<RunestoneSummary[]>(`${API_V1}/runestone${qs ? `?${qs}` : ''}`);
}

/** One page of the listing plus its total and author facet (PLAN-31). */
function hubListRunestonesPage(
  query: RunestoneListQuery,
  request: OffsetRequest,
): Promise<DocumentListPage<RunestoneSummary>> {
  return apiGet<DocumentListPage<RunestoneSummary>>(
    `${API_V1}/runestone?${pagedParams(listParams(query), request)}`,
  );
}

/**
 * Fetch by slug. The API 301s stale-name slugs to the canonical one and fetch
 * follows it transparently — compare `doc.slug` to fix the address bar.
 * Returns null on 404 (the creative not-carved page).
 */
async function hubFetchRunestone(slug: string): Promise<RunestoneDoc | null> {
  try {
    return await apiGet<RunestoneDoc>(`${API_V1}/runestone/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

const hubSaveRunestone = (input: { name?: string; content: string }): Promise<RunestoneDoc> =>
  apiSend<RunestoneDoc>('POST', `${API_V1}/runestone`, input);

const hubUpdateRunestone = (
  id: string,
  input: { name?: string; content?: string },
): Promise<RunestoneDoc> => apiSend<RunestoneDoc>('PUT', `${API_V1}/runestone/${id}`, input);

const hubDeleteRunestone = (id: string): Promise<null> =>
  apiSend<null>('DELETE', `${API_V1}/runestone/${id}`);

/*
 * The hub's document API. On the standalone site each is a stub that throws
 * HubUnavailableError and opens the Bifröst sheet, with no request (PLAN-35).
 */
export const listRunestones: typeof hubListRunestones = __HUB__
  ? hubListRunestones
  : hubOnly('listRunestones');
export const listRunestonesPage: typeof hubListRunestonesPage = __HUB__
  ? hubListRunestonesPage
  : hubOnly('listRunestonesPage');
export const fetchRunestone: typeof hubFetchRunestone = __HUB__
  ? hubFetchRunestone
  : hubOnly('fetchRunestone');
export const saveRunestone: typeof hubSaveRunestone = __HUB__
  ? hubSaveRunestone
  : hubOnly('saveRunestone');
export const updateRunestone: typeof hubUpdateRunestone = __HUB__
  ? hubUpdateRunestone
  : hubOnly('updateRunestone');
export const deleteRunestone: typeof hubDeleteRunestone = __HUB__
  ? hubDeleteRunestone
  : hubOnly('deleteRunestone');
