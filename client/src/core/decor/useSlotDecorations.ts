import { useSyncExternalStore } from 'react';
import { themeEngine } from '../theme';
import { decorPrefsSnapshot, isDecorationEnabled, onDecorPrefsChange } from './prefs';
import { decorationToken, installedSeason } from './registry';
import type { DecorationMeta, DecorSlotName } from './types';

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

/**
 * The installed season's decorations for `slot` that show right now: the
 * applied theme turns each on (`--decor-<id>`), and this device has not
 * switched it off. Re-read on every theme change and every switch.
 */
export function useSlotDecorations(slot: DecorSlotName): DecorationMeta[] {
  const tokens = useSyncExternalStore(subscribeTheme, activeTokens);
  useSyncExternalStore(onDecorPrefsChange, decorPrefsSnapshot);
  const season = installedSeason();
  if (!season) return [];
  return season.decorations.filter(
    (decoration) =>
      decoration.slot === slot &&
      optInLevel(tokens, decorationToken(decoration.id)) > 0 &&
      (!decoration.switchable || isDecorationEnabled(decoration.id)),
  );
}
