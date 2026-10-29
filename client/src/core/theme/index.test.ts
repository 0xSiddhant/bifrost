import { describe, expect, it } from 'vitest';
import { resolveThemeChoice } from '.';

const themes = [
  { id: 'aurora', mode: 'dark' as const },
  { id: 'daybreak', mode: 'light' as const },
  { id: 'midgard', mode: 'light' as const },
  { id: 'halloween', mode: 'dark' as const },
];

describe('resolveThemeChoice (PLAN-04 resolution order)', () => {
  it('visitor choice wins over everything', () => {
    expect(
      resolveThemeChoice({
        stored: 'midgard',
        defaultId: 'aurora',
        builtInId: 'halloween',
        themes,
        prefersLight: false,
      }),
    ).toBe('midgard');
  });

  it('ignores a stored choice that no longer exists', () => {
    expect(
      resolveThemeChoice({
        stored: 'gone',
        defaultId: 'aurora',
        builtInId: 'halloween',
        themes,
        prefersLight: true,
      }),
    ).toBe('aurora');
  });

  it('server default beats the built-in default and prefers-color-scheme when explicitly set', () => {
    expect(
      resolveThemeChoice({
        stored: null,
        defaultId: 'aurora',
        builtInId: 'halloween',
        themes,
        prefersLight: true,
      }),
    ).toBe('aurora');
  });

  it('first visit, no household default: the built-in default, in either colour scheme', () => {
    for (const prefersLight of [false, true]) {
      expect(
        resolveThemeChoice({
          stored: null,
          defaultId: null,
          builtInId: 'halloween',
          themes,
          prefersLight,
        }),
      ).toBe('halloween');
    }
  });

  it('a built-in default that is not bundled falls through to the colour scheme', () => {
    expect(
      resolveThemeChoice({
        stored: null,
        defaultId: null,
        builtInId: 'gone',
        themes,
        prefersLight: true,
      }),
    ).toBe('daybreak');
  });

  it('first visit, no default at all: OS dark mode lands on aurora, light on daybreak', () => {
    expect(
      resolveThemeChoice({
        stored: null,
        defaultId: null,
        builtInId: null,
        themes,
        prefersLight: false,
      }),
    ).toBe('aurora');
    expect(
      resolveThemeChoice({
        stored: null,
        defaultId: null,
        builtInId: null,
        themes,
        prefersLight: true,
      }),
    ).toBe('daybreak');
  });

  it('falls back to the first theme when no mode matches', () => {
    const darkOnly = [{ id: 'aurora', mode: 'dark' as const }];
    expect(
      resolveThemeChoice({
        stored: null,
        defaultId: null,
        builtInId: null,
        themes: darkOnly,
        prefersLight: true,
      }),
    ).toBe('aurora');
  });

  it('returns null with no themes at all', () => {
    expect(
      resolveThemeChoice({
        stored: null,
        defaultId: null,
        builtInId: null,
        themes: [],
        prefersLight: false,
      }),
    ).toBeNull();
  });
});
