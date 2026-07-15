import { contrastWarnings, parseColor } from './contrast.js';
import type { ResolvedTheme, ThemeFile } from './ports.js';

/** `#2dd4bf` + 0.12 → `rgba(45, 212, 191, 0.12)`; passthrough when unparseable. */
function alpha(color: string, value: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${value})`;
}

/**
 * Fill every omitted optional token with a value derived from the required
 * color roles, so a minimal theme (14 colors + metadata) still themes the
 * whole app — sky, glows, syntax colors, QR palette included. Authored
 * values always win; this only fills holes.
 */
export function resolveTheme(theme: ThemeFile, builtIn: boolean): ResolvedTheme {
  const t = theme.tokens;
  const dark = theme.mode === 'dark';
  const accent = t['--accent'] ?? '#2dd4bf';
  const accent2 = t['--accent-2'] ?? '#8b7cf6';
  const ok = t['--ok'] ?? '#4ade80';
  const warn = t['--warn'] ?? '#fbbf24';
  const text = t['--text'] ?? '#e9edf5';
  const textMuted = t['--text-muted'] ?? '#8b94a7';
  const surface = t['--surface'] ?? '#131824';

  const derived: Record<string, string> = {
    '--bridge': `linear-gradient(90deg, ${accent} 0%, ${accent2} 50%, ${ok} 100%)`,
    '--accent-grad': `linear-gradient(135deg, ${accent} 0%, ${alpha(accent, 0.75)} 100%)`,
    '--sky': [
      `radial-gradient(55% 42% at 12% -5%, ${alpha(accent, dark ? 0.16 : 0.12)}, transparent 65%)`,
      `radial-gradient(50% 38% at 88% 2%, ${alpha(accent2, dark ? 0.18 : 0.12)}, transparent 65%)`,
      `radial-gradient(65% 50% at 50% 112%, ${alpha(ok, dark ? 0.1 : 0.14)}, transparent 60%)`,
    ].join(', '),
    '--stars': dark ? alpha(text, 0.55) : 'transparent',
    '--stars-alpha': dark ? '1' : '0',
    '--glow-teal': `0 0 26px ${alpha(accent, dark ? 0.35 : 0.22)}`,
    '--glow-violet': `0 0 26px ${alpha(accent2, dark ? 0.38 : 0.22)}`,
    '--glow-soft': `0 0 46px ${alpha(accent2, dark ? 0.16 : 0.1)}`,
    '--tone-teal': accent,
    '--tone-teal-soft': alpha(accent, dark ? 0.13 : 0.1),
    '--tone-violet': accent2,
    '--tone-violet-soft': alpha(accent2, dark ? 0.14 : 0.1),
    '--header-veil': alpha(surface, dark ? 0.78 : 0.82),
    '--card-sheen': dark
      ? `linear-gradient(180deg, ${alpha(text, 0.05)} 0%, transparent 42%)`
      : `linear-gradient(180deg, ${alpha(surface, 0.65)} 0%, transparent 42%)`,
    '--relic-alpha': dark ? '0.07' : '0.09',
    '--relic-muted': textMuted,
    '--shadow-1': dark ? '0 1px 3px rgba(0, 0, 0, 0.35)' : '0 1px 3px rgba(60, 50, 30, 0.12)',
    '--shadow-2': dark ? '0 8px 28px rgba(0, 0, 0, 0.45)' : '0 8px 28px rgba(60, 50, 30, 0.16)',
    '--syn-key': accent,
    '--syn-string': ok,
    '--syn-number': accent2,
    '--syn-bool': warn,
    '--syn-null': textMuted,
    '--syn-punct': textMuted,
    // Scanners need dark-on-light regardless of theme mode.
    '--qr-module-a': dark ? '#0f766e' : '#0c5f54',
    '--qr-module-b': dark ? '#6d28d9' : '#4c3aa8',
    '--qr-bg': dark ? '#eef1fa' : '#ffffff',
  };

  const tokens = { ...derived, ...theme.tokens };
  return {
    id: theme.id,
    name: theme.name,
    mode: theme.mode,
    preview: { bg: tokens['--bg'] ?? '#000000', accent },
    builtIn,
    warnings: contrastWarnings(tokens),
    tokens,
  };
}
