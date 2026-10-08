import {
  ApiError,
  apiGet,
  apiSend,
  hubOnly,
  pagedParams,
  type DocumentListPage,
  type OffsetRequest,
} from './api';

export interface AtlasConfig {
  /** Document size cap in KB — the server's own .env value, baked in at build time. */
  maxDocKb: number;
}

/**
 * The size cap, baked in at build time from the same `.env` key the server
 * enforces on save (PLAN-35): one number, so the client never allows what the
 * server refuses. A changed cap needs a client rebuild; the server's boot log
 * names any drift.
 */
export const ATLAS_CONFIG: AtlasConfig = {
  maxDocKb: __BIFROST_DEFAULTS__.caps.atlasMaxDocKb,
};

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

function listParams(query: AtlasListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.author) params.set('author', query.author);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  return params;
}

function hubListAtlases(query: AtlasListQuery = {}): Promise<AtlasSummary[]> {
  const qs = listParams(query).toString();
  return apiGet<AtlasSummary[]>(`/api/atlas${qs ? `?${qs}` : ''}`);
}

/** One page of the listing plus its total and author facet (PLAN-31). */
function hubListAtlasesPage(
  query: AtlasListQuery,
  request: OffsetRequest,
): Promise<DocumentListPage<AtlasSummary>> {
  return apiGet<DocumentListPage<AtlasSummary>>(
    `/api/atlas?${pagedParams(listParams(query), request)}`,
  );
}

/**
 * Fetch by slug. The API 301s stale-name slugs to the canonical one and fetch
 * follows it transparently — compare `doc.slug` to fix the address bar.
 * Returns null on 404 (the creative not-grown page).
 */
async function hubFetchAtlas(slug: string): Promise<AtlasDoc | null> {
  try {
    return await apiGet<AtlasDoc>(`/api/atlas/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

const hubSaveAtlas = (input: { name?: string; content: string }): Promise<AtlasDoc> =>
  apiSend<AtlasDoc>('POST', '/api/atlas', input);

const hubUpdateAtlas = (
  id: string,
  input: { name?: string; content?: string },
): Promise<AtlasDoc> => apiSend<AtlasDoc>('PUT', `/api/atlas/${id}`, input);

const hubDeleteAtlas = (id: string): Promise<null> => apiSend<null>('DELETE', `/api/atlas/${id}`);

/*
 * The hub's document API. On the standalone site each is a stub that throws
 * HubUnavailableError and opens the Bifröst sheet, with no request (PLAN-35).
 */
export const fetchAtlas: typeof hubFetchAtlas = __HUB__ ? hubFetchAtlas : hubOnly('fetchAtlas');
export const saveAtlas: typeof hubSaveAtlas = __HUB__ ? hubSaveAtlas : hubOnly('saveAtlas');
export const updateAtlas: typeof hubUpdateAtlas = __HUB__ ? hubUpdateAtlas : hubOnly('updateAtlas');
export const deleteAtlas: typeof hubDeleteAtlas = __HUB__ ? hubDeleteAtlas : hubOnly('deleteAtlas');
export const listAtlases: typeof hubListAtlases = __HUB__ ? hubListAtlases : hubOnly('listAtlases');
export const listAtlasesPage: typeof hubListAtlasesPage = __HUB__
  ? hubListAtlasesPage
  : hubOnly('listAtlasesPage');
