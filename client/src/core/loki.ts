import { API_V1, apiGet, apiSend, hubOnly } from './api';

/**
 * Loki execution policy (PLAN-12 Part B). The workbench reads the public config
 * to gate its Run UI and pass the runner its limits; Heimdall's Loki card
 * PATCHes it (admin-only). Both go through the loki module's own routes so no
 * feature imports another.
 */
export interface LokiConfig {
  executionEnabled: boolean;
  fetchAllowed: boolean;
  runTimeoutMs: number;
  consoleMaxEntries: number;
  timeoutMin: number;
  timeoutMax: number;
}

export type LokiSettingsPatch = Partial<{
  executionEnabled: boolean;
  fetchAllowed: boolean;
  runTimeoutMs: number;
  consoleMaxEntries: number;
}>;

const hubFetchLokiConfig = (): Promise<LokiConfig> => apiGet<LokiConfig>(`${API_V1}/loki/config`);

const hubPatchLokiSettings = (patch: LokiSettingsPatch): Promise<LokiConfig> =>
  apiSend<LokiConfig>('PATCH', `${API_V1}/loki/settings`, patch);

// Hub-only: on the standalone site each is a stub that makes no request (PLAN-35).
export const fetchLokiConfig: typeof hubFetchLokiConfig = __HUB__ ? hubFetchLokiConfig : hubOnly('fetchLokiConfig');
export const patchLokiSettings: typeof hubPatchLokiSettings = __HUB__ ? hubPatchLokiSettings : hubOnly('patchLokiSettings');
