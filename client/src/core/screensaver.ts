import { apiGet, apiSend } from './api';

/**
 * Nótt (idle screensaver) policy. The app reads the public config on load and
 * on the `screensaver.settingsUpdated` SSE event to arm the idle timer and
 * configure the canvas; Heimdall's Nótt card PATCHes it (admin-only). Both go
 * through the screensaver module's own routes so no feature imports another.
 */
export type ParticleDensity = 'low' | 'medium' | 'high';
export type MotionBand = 'calm' | 'normal' | 'lively';

export interface ScreensaverConfig {
  enabled: boolean;
  idleSeconds: number;
  density: ParticleDensity;
  motion: MotionBand;
  connectLines: boolean;
  mouseReactive: boolean;
  showQuotes: boolean;
  quoteRotateSeconds: number;
  /** Bounds the Heimdall control clamps its inputs to. */
  idleMin: number;
  idleMax: number;
  rotateMin: number;
  rotateMax: number;
}

export type ScreensaverSettingsPatch = Partial<{
  enabled: boolean;
  idleSeconds: number;
  density: ParticleDensity;
  motion: MotionBand;
  connectLines: boolean;
  mouseReactive: boolean;
  showQuotes: boolean;
  quoteRotateSeconds: number;
}>;

export const fetchScreensaverConfig = (): Promise<ScreensaverConfig> =>
  apiGet<ScreensaverConfig>('/api/screensaver/config');

export const patchScreensaverSettings = (
  patch: ScreensaverSettingsPatch,
): Promise<ScreensaverConfig> =>
  apiSend<ScreensaverConfig>('PATCH', '/api/screensaver/settings', patch);
