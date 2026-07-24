import { apiGet, apiSend } from './api';

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

export const fetchLokiConfig = (): Promise<LokiConfig> => apiGet<LokiConfig>('/api/loki/config');

export const patchLokiSettings = (patch: LokiSettingsPatch): Promise<LokiConfig> =>
  apiSend<LokiConfig>('PATCH', '/api/loki/settings', patch);
