import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { BUNDLED_THEMES } from './bundled';
import { contrastRatio, contrastWarnings } from './color';
import { resolveTheme, type ThemeFile } from './resolve';
import { themeSchema } from './schema';

/**
 * A theme is code since PLAN-35, so a bad one fails here instead of
 * rendering: every file in `client/src/assets/themes/` must match the schema
 * the server used to enforce, and pass the contrast floor it used to warn
 * about. The resolve cases are the server's `theme-validation.test.ts`,
 * ported with the code.
 */

const THEMES_DIR = new URL('../../assets/themes/', import.meta.url);
const files = readdirSync(THEMES_DIR).filter((name) => name.endsWith('.json'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(themeSchema);

function minimalTheme(overrides: Record<string, unknown> = {}) {
  return {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    tokens: {
      '--bg': '#0a0a12',
      '--surface': '#12121f',
      '--surface-2': '#1a1a2c',
      '--text': '#ececf5',
      '--text-muted': '#8a8fa5',
      '--border': '#26263c',
      '--accent': '#5eead4',
      '--accent-2': '#a78bfa',
      '--ok': '#4ade80',
      '--danger': '#f87171',
      '--warn': '#fbbf24',
      '--accent-soft': 'rgba(94, 234, 212, 0.12)',
      '--danger-soft': 'rgba(248, 113, 113, 0.12)',
      '--scrim': 'rgba(0, 0, 0, 0.7)',
    } as Record<string, string>,
    ...overrides,
  };
}

describe('the bundled themes', () => {
  it('are the seven built-ins, all of them bundled', () => {
    expect(files.sort()).toEqual([
      'aurora.json',
      'daybreak.json',
      'ghibli-dusk.json',
      'gryffindor.json',
      'olympus.json',
      'slytherin.json',
      'tokyo.json',
    ]);
    expect(BUNDLED_THEMES.map((theme) => `${theme.id}.json`).sort()).toEqual(files);
  });

  it.each(files)('%s matches the theme schema', (file) => {
    const theme: unknown = JSON.parse(readFileSync(new URL(file, THEMES_DIR), 'utf8'));
    const valid = validate(theme);
    expect(validate.errors ?? [], file).toEqual([]);
    expect(valid).toBe(true);
    // The id is the file name: the switcher and the household default use it.
    expect((theme as ThemeFile).id).toBe(file.replace(/\.json$/, ''));
  });

  it.each(files)('%s keeps text readable: no contrast below 4.5:1', (file) => {
    const theme = JSON.parse(readFileSync(new URL(file, THEMES_DIR), 'utf8')) as ThemeFile;
    expect(contrastWarnings(resolveTheme(theme).tokens)).toEqual([]);
  });

  it('are sorted by name, as the server listed them', () => {
    const names = BUNDLED_THEMES.map((theme) => theme.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('the theme schema', () => {
  it('accepts a minimal 14-colour theme', () => {
    expect(validate(minimalTheme())).toBe(true);
  });

  it('names the exact path of a missing colour role', () => {
    const theme = minimalTheme();
    delete theme.tokens['--accent'];
    expect(validate(theme)).toBe(false);
    expect(validate.errors?.some((error) => JSON.stringify(error).includes('--accent'))).toBe(true);
    expect(validate.errors?.[0]?.instancePath).toContain('/tokens');
  });

  it('collects every error, not just the first', () => {
    expect(validate(minimalTheme({ mode: 'dusk', id: 'NOT VALID' }))).toBe(false);
    expect(validate.errors?.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects unknown token keys', () => {
    const theme = minimalTheme();
    theme.tokens['--evil'] = '#fff';
    expect(validate(theme)).toBe(false);
  });

  it('rejects url() smuggled into a css value (themes never fetch)', () => {
    const theme = minimalTheme();
    theme.tokens['--sky'] = 'url(https://evil.example/x.png)';
    expect(validate(theme)).toBe(false);
  });

  it('rejects fonts the app does not host itself', () => {
    const theme = minimalTheme();
    theme.tokens['--font-body'] = "'Comic Sans MS', cursive";
    expect(validate(theme)).toBe(false);
  });
});

describe('resolveTheme derived defaults (the server cases, ported)', () => {
  const resolved = () => resolveTheme(minimalTheme() as ThemeFile);

  it('fills syntax, qr and atmosphere tokens for a minimal theme', () => {
    const theme = resolved();
    expect(theme.tokens['--syn-key']).toBe('#5eead4');
    expect(theme.tokens['--syn-string']).toBe('#4ade80');
    expect(theme.tokens['--bridge']).toContain('#5eead4');
    expect(theme.tokens['--sky']).toContain('radial-gradient');
    expect(theme.tokens['--qr-bg']).toBe('#eef1fa');
    expect(theme.tokens['--stars-alpha']).toBe('1');
    expect(theme.preview).toEqual({ bg: '#0a0a12', accent: '#5eead4' });
  });

  it('derives diff tokens from ok, danger and accent', () => {
    const theme = resolved();
    expect(theme.tokens['--diff-add']).toBe('#4ade80');
    expect(theme.tokens['--diff-remove']).toBe('#f87171');
    expect(theme.tokens['--diff-change']).toBe('#5eead4');
    expect(theme.tokens['--diff-add-soft']).toBe('rgba(74, 222, 128, 0.16)');
  });

  it('never overrides authored values', () => {
    const theme = minimalTheme();
    theme.tokens['--syn-key'] = '#ff0000';
    expect(resolveTheme(theme as ThemeFile).tokens['--syn-key']).toBe('#ff0000');
  });

  it('derives light-mode variants for light themes', () => {
    const theme = resolveTheme(minimalTheme({ mode: 'light' }) as ThemeFile);
    expect(theme.tokens['--stars']).toBe('transparent');
    expect(theme.tokens['--stars-alpha']).toBe('0');
    expect(theme.tokens['--qr-bg']).toBe('#ffffff');
  });
});

describe('contrast lint', () => {
  it('computes known ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 1);
  });

  it('flags text below 4.5:1', () => {
    const warnings = contrastWarnings({ '--text': '#777777', '--bg': '#666666' });
    expect(warnings[0]).toContain('--text');
  });
});
