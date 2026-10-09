import { API_V1, apiSend } from '../api';
import { fetchHeimdallAccess } from '../heimdallAccess';
import { fetchLokiConfig, patchLokiSettings, type LokiConfig } from '../loki';
import {
  fetchScreensaverConfig,
  patchScreensaverSettings,
  type ScreensaverConfig,
} from '../screensaver';
import { HubSettingsStore, LocalSettingsStore, type SettingsStore } from './store';

export type { SettingsStore } from './store';

/**
 * The three settings areas Heimdall edits that also exist on the standalone
 * site (PLAN-35): Nótt, Loki's run policy, and how Heimdall opens. Each is the
 * hub's API in the hub build and this browser's `localStorage` standalone,
 * seeded from the build-time `.env` defaults. Pages read them only from here.
 */

/** The bounds Heimdall's controls clamp to: the server's own, not settings. */
const SCREENSAVER_BOUNDS = { idleMin: 5, idleMax: 3600, rotateMin: 4, rotateMax: 120 };
const LOKI_BOUNDS = { timeoutMin: 250, timeoutMax: 30000 };

/** A broadcast carries the settings without the bounds; keep the ones we have. */
const merge =
  <T>() =>
  (payload: unknown, current: T | null): T | null =>
    current && payload && typeof payload === 'object'
      ? { ...current, ...(payload as Partial<T>) }
      : null;

export const screensaverSettings: SettingsStore<ScreensaverConfig> = __HUB__
  ? new HubSettingsStore(
      fetchScreensaverConfig,
      patchScreensaverSettings,
      'screensaver.settingsUpdated',
      merge<ScreensaverConfig>(),
    )
  : new LocalSettingsStore('screensaver', {
      ...__BIFROST_DEFAULTS__.screensaver,
      ...SCREENSAVER_BOUNDS,
    });

export const lokiSettings: SettingsStore<LokiConfig> = __HUB__
  ? new HubSettingsStore(
      fetchLokiConfig,
      patchLokiSettings,
      'loki.settingsUpdated',
      merge<LokiConfig>(),
    )
  : new LocalSettingsStore('loki', { ...__BIFROST_DEFAULTS__.loki, ...LOKI_BOUNDS });

/** How Heimdall opens: the keyboard shortcut, and the taps on the wordmark. */
export interface AccessConfig {
  shortcut: string;
  tapCount: number;
}

const hubAccess = async (): Promise<AccessConfig> => {
  const { shortcut, tapCount } = await fetchHeimdallAccess();
  return { shortcut, tapCount };
};

const hubPatchAccess = (patch: Partial<AccessConfig>): Promise<AccessConfig> =>
  apiSend<AccessConfig>('PATCH', `${API_V1}/heimdall/settings`, patch);

export const accessSettings: SettingsStore<AccessConfig> = __HUB__
  ? new HubSettingsStore(hubAccess, hubPatchAccess, 'settings.updated', (payload) =>
      payload && typeof payload === 'object' && 'shortcut' in payload && 'tapCount' in payload
        ? { shortcut: String(payload.shortcut), tapCount: Number(payload.tapCount) }
        : null,
    )
  : new LocalSettingsStore('heimdall', { ...__BIFROST_DEFAULTS__.heimdall });
