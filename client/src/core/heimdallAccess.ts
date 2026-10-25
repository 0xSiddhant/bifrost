import { API_V1, apiGet, hubOnly } from './api';

/**
 * `GET /api/heimdall/access`: the public door to Heimdall, plus the household
 * default theme (PLAN-35 added `defaultThemeId`, since `/api/v1/themes` that
 * used to carry it is gone). Two readers at boot, the open gesture and the
 * theme engine, so the request is shared rather than made twice.
 */
export interface HeimdallAccess {
  shortcut: string;
  tapCount: number;
  /** The household default theme Heimdall set, or null to follow the device. */
  defaultThemeId: string | null;
}

let pending: Promise<HeimdallAccess> | null = null;

function hubFetchHeimdallAccess(): Promise<HeimdallAccess> {
  pending ??= apiGet<HeimdallAccess>(`${API_V1}/heimdall/access`).catch((error: unknown) => {
    // A failed read is not cached: the next caller asks again.
    pending = null;
    throw error;
  });
  return pending;
}

/** Hub-only: the standalone site keeps its open gesture in this browser. */
export const fetchHeimdallAccess: typeof hubFetchHeimdallAccess = __HUB__
  ? hubFetchHeimdallAccess
  : hubOnly('fetchHeimdallAccess');
