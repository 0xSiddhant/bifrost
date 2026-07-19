import { apiGet } from '../../core/api';

export interface RunestoneConfig {
  /** Document size cap in KB — from .env via the server, never hardcoded. */
  maxDocKb: number;
}

export const fetchRunestoneConfig = (): Promise<RunestoneConfig> =>
  apiGet<RunestoneConfig>('/api/runestone/config');
