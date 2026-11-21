import { useSyncExternalStore } from 'react';
import { getSnowfallEnabled, onRelicPrefsChange } from '../relicPrefs';
import { themeEngine } from '../theme';

/**
 * The opt-in decorations of the Yule world (snowfall, string lights, the
 * footer scene) are drawn only when the applied theme turns them on, with a
 * 0–1 token (`--snow-alpha`, `--lights-alpha`, `--footer-scene-alpha`). Read
 * from the engine's applied tokens rather than `getComputedStyle`, so the
 * answer follows every theme switch and is testable without layout.
 */

const subscribeTheme = (onChange: () => void) => themeEngine.subscribe(() => onChange());
const activeTokens = () => themeEngine.getActiveTokens();

/**
 * The level a theme gives a decoration: its token as a number in (0, 1], or 0
 * when it is absent, not a number, or 0. The schema guarantees the format, so
 * a value that does not parse is validation control flow, not a failure.
 */
export function optInLevel(tokens: Readonly<Record<string, string>>, token: string): number {
  const value = Number.parseFloat(tokens[token] ?? '');
  return Number.isFinite(value) && value > 0 ? Math.min(value, 1) : 0;
}

/** The applied theme's level for `token`, re-read on every theme change. */
export function useThemeOptIn(token: string): number {
  return optInLevel(useSyncExternalStore(subscribeTheme, activeTokens), token);
}

/** This device's Snowfall switch (Heimdall → Sky Relics), live. */
export function useSnowfallEnabled(): boolean {
  return useSyncExternalStore(onRelicPrefsChange, getSnowfallEnabled);
}
