import { describe, expect, it } from 'vitest';
import { resolveThemeChoice } from './theme';

const themes = [
  { id: 'aurora', mode: 'dark' as const },
  { id: 'daybreak', mode: 'light' as const },
  { id: 'midgard', mode: 'light' as const },
];

describe('resolveThemeChoice (PLAN-04 resolution order)', () => {
  it('visitor choice wins over everything', () => {
    expect(
      resolveThemeChoice({ stored: 'midgard', defaultId: 'aurora', themes, prefersLight: false }),
    ).toBe('midgard');
  });

  it('ignores a stored choice that no longer exists', () => {
    expect(
      resolveThemeChoice({ stored: 'gone', defaultId: 'aurora', themes, prefersLight: true }),
    ).toBe('aurora');
  });

  it('server default beats prefers-color-scheme when explicitly set', () => {
    expect(
      resolveThemeChoice({ stored: null, defaultId: 'aurora', themes, prefersLight: true }),
    ).toBe('aurora');
  });

  it('first visit, no default: OS dark mode lands on aurora, light on daybreak', () => {
    expect(resolveThemeChoice({ stored: null, defaultId: null, themes, prefersLight: false })).toBe(
      'aurora',
    );
    expect(resolveThemeChoice({ stored: null, defaultId: null, themes, prefersLight: true })).toBe(
      'daybreak',
    );
  });

  it('falls back to the first theme when no mode matches', () => {
    const darkOnly = [{ id: 'aurora', mode: 'dark' as const }];
    expect(
      resolveThemeChoice({ stored: null, defaultId: null, themes: darkOnly, prefersLight: true }),
    ).toBe('aurora');
  });

  it('returns null with no themes at all', () => {
    expect(
      resolveThemeChoice({ stored: null, defaultId: null, themes: [], prefersLight: false }),
    ).toBeNull();
  });
});
