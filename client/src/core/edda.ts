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

export interface EddaConfig {
  /** Document size cap in KB — the server's own .env value, baked in at build time. */
  maxDocKb: number;
  /** Above this size the live preview auto-degrades to manual refresh. */
  livePreviewMaxKb: number;
}

/**
 * The size cap, baked in at build time from the same `.env` key the server
 * enforces on save (PLAN-35): one number, so the client never allows what the
 * server refuses. A changed cap needs a client rebuild; the server's boot log
 * names any drift.
 */
export const EDDA_CONFIG: EddaConfig = {
  maxDocKb: __BIFROST_DEFAULTS__.caps.eddaMaxDocKb,
  livePreviewMaxKb: __BIFROST_DEFAULTS__.caps.eddaLivePreviewMaxKb,
};

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

function hubListEddas(query: EddaListQuery = {}): Promise<EddaSummary[]> {
  const qs = listParams(query).toString();
  return apiGet<EddaSummary[]>(`${API_V1}/edda${qs ? `?${qs}` : ''}`);
}

/** One page of the listing plus its total and author facet (PLAN-31). */
function hubListEddasPage(
  query: EddaListQuery,
  request: OffsetRequest,
): Promise<DocumentListPage<EddaSummary>> {
  return apiGet<DocumentListPage<EddaSummary>>(
    `${API_V1}/edda?${pagedParams(listParams(query), request)}`,
  );
}

/**
 * Fetch by slug. The API 301s stale-name slugs to the canonical one and fetch
 * follows it transparently — compare `doc.slug` to fix the address bar.
 * Returns null on 404 (the creative not-written page).
 */
async function hubFetchEdda(slug: string): Promise<EddaDoc | null> {
  try {
    return await apiGet<EddaDoc>(`${API_V1}/edda/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

const hubSaveEdda = (input: { name?: string; content: string }): Promise<EddaDoc> =>
  apiSend<EddaDoc>('POST', `${API_V1}/edda`, input);

const hubUpdateEdda = (id: string, input: { name?: string; content?: string }): Promise<EddaDoc> =>
  apiSend<EddaDoc>('PUT', `${API_V1}/edda/${id}`, input);

const hubDeleteEdda = (id: string): Promise<null> =>
  apiSend<null>('DELETE', `${API_V1}/edda/${id}`);

/*
 * The hub's document API. On the standalone site each is a stub that throws
 * HubUnavailableError and opens the Bifröst sheet, with no request (PLAN-35).
 */
export const listEddas: typeof hubListEddas = __HUB__ ? hubListEddas : hubOnly('listEddas');
export const listEddasPage: typeof hubListEddasPage = __HUB__
  ? hubListEddasPage
  : hubOnly('listEddasPage');
export const fetchEdda: typeof hubFetchEdda = __HUB__ ? hubFetchEdda : hubOnly('fetchEdda');
export const saveEdda: typeof hubSaveEdda = __HUB__ ? hubSaveEdda : hubOnly('saveEdda');
export const updateEdda: typeof hubUpdateEdda = __HUB__ ? hubUpdateEdda : hubOnly('updateEdda');
export const deleteEdda: typeof hubDeleteEdda = __HUB__ ? hubDeleteEdda : hubOnly('deleteEdda');
