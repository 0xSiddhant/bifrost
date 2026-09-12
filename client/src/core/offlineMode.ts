import { apiGet, apiSend } from './api';

/**
 * Offline mode (PLAN-22) — the policy half.
 *
 * The warm load itself is an eager `import()` and lives in
 * `app/offlineWarmLoad.ts`, because `core/` may not import `features/`. What
 * lives here is everything that is *not* a feature import: the config shape,
 * the two calls against the offline-mode module's own routes (public GET,
 * admin PATCH — same split as `core/screensaver.ts`), and the status the
 * header toggle renders.
 */

/** One warmable page, as the server's code-owned registry describes it. */
export interface OfflineModeTarget {
  id: string;
  label: string;
}

export interface OfflineModeConfig {
  targets: OfflineModeTarget[];
  /** Ids an admin has switched off in Heimdall; a subset of `targets`. */
  disabled: string[];
}

/**
 * Bounded, unlike most reads: the toggle stays disabled until this answers, and
 * a host that has gone away leaves the request hanging rather than refusing it
 * — so without a timeout the switch is dead for as long as the browser is
 * willing to wait. Failing fast at least lets a retry happen.
 */
const CONFIG_TIMEOUT_MS = 8_000;

export const fetchOfflineModeConfig = (): Promise<OfflineModeConfig> =>
  apiGet<OfflineModeConfig>('/api/offline-mode/config', { timeoutMs: CONFIG_TIMEOUT_MS });

export const setOfflineModeTargetEnabled = (
  id: string,
  enabled: boolean,
): Promise<OfflineModeConfig> =>
  apiSend<OfflineModeConfig>('PATCH', '/api/offline-mode/settings', { id, enabled });

/** The targets a click should warm: registry order, minus whatever is disabled. */
export const enabledTargets = (config: OfflineModeConfig): OfflineModeTarget[] =>
  config.targets.filter((target) => !config.disabled.includes(target.id));

/** Registry label for an id, falling back to the id so a pill is never blank. */
export const targetLabel = (config: OfflineModeConfig, id: string): string =>
  config.targets.find((target) => target.id === id)?.label ?? id;

/**
 * Toggle state, held in the app shell rather than a page: the warmed modules
 * belong to the tab, so navigating between the two gated pages must not reset
 * the pill. `off` is also the state after the user switches back off — the code
 * already fetched stays in the tab's module registry either way (nothing can
 * un-import it), so the switch arms the load, it does not hold it.
 */
export interface WarmLoadStatus {
  state: 'off' | 'warming' | 'ready' | 'partial';
  /** Targets whose import resolved. */
  loaded: number;
  /** Labels of targets whose import rejected — named in the `partial` pill. */
  failed: string[];
}

export const OFF_STATUS: WarmLoadStatus = { state: 'off', loaded: 0, failed: [] };
