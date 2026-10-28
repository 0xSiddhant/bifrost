import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { BUNDLED_THEMES } from './bundled';
import {
  accentTextBackdrops,
  contrastRatio,
  contrastWarnings,
  parseColor,
  parseRgba,
} from './color';
import { ACCENT_TEXT_MAX_STEPS, ACCENT_TEXT_STEP, resolveTheme, type ThemeFile } from './resolve';
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

  // Codex review: a colour the schema accepted but the lint could not read was
  // skipped, and passed. Both now use one grammar (`COLOR_PATTERN`).
  it.each([
    ['#abc', true],
    ['#aabbcc', true],
    ['#aabbcc80', true],
    ['rgb(40%, 40%, 40%)', true],
    ['rgba(10.5, 20, 30, 0.5)', true],
    ['rgba(1, 2, 3, 50%)', true],
    ['rgba( 1 ,2,3, .5 )', true],
    ['transparent', true],
    ['#abcde', false],
    ['rgb(1, 2)', false],
    ['rgb(50%, 20, 30)', false],
    ['rgb(1 2 3)', false],
    ['rgb(1, 2, 3, 4, 5)', false],
    ['rgb(1.2.3, 4, 5)', false],
    ['rgba(,,,)', false],
    ['hsl(0, 0%, 50%)', false],
    ['red', false],
  ])('accepts %s exactly when the contrast check can read it (%s)', (value, readable) => {
    const theme = minimalTheme();
    theme.tokens['--text'] = value;
    expect(validate(theme)).toBe(readable);
    expect(parseRgba(value) !== null).toBe(readable);
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

  it('reads rgb() in percentages and decimals, as CSS does', () => {
    expect(parseRgba('rgb(40%, 40%, 40%)')).toEqual({ r: 102, g: 102, b: 102, a: 1 });
    expect(parseRgba('rgba(10.4, 20, 30, 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseRgba('rgb(300, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseRgba('rgba(150%, 0%, 0%, 2)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('transparent')).toBeNull();
  });

  it('measures a backdrop written in percentages instead of skipping it', () => {
    const theme = minimalTheme();
    Object.assign(theme.tokens, {
      '--bg': 'rgb(40%, 40%, 40%)',
      '--surface': '#000000',
      '--accent-text': '#7a7a7a',
    });

    expect(contrastWarnings(resolveTheme(theme as ThemeFile).tokens)).toContainEqual(
      expect.stringMatching(/^--accent-text on --bg has contrast 1\.34:1/),
    );
  });

  it('flags a surface that is translucent, as text is measured on it as solid', () => {
    const warnings = contrastWarnings({ '--text': '#ffffff', '--surface': 'rgba(0, 0, 0, 0.5)' });
    expect(warnings).toContainEqual(
      expect.stringContaining('--surface is rgba(0, 0, 0, 0.5), which is translucent'),
    );
  });
});

// PLAN-40: accent-coloured text gets its own derived token.
describe('--accent-text', () => {
  /** The HSL hue of a colour, in degrees. */
  function hue(value: string): number {
    const rgb = parseColor(value);
    if (!rgb) throw new Error(value);
    const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
    const max = Math.max(r, g, b);
    const span = max - Math.min(r, g, b);
    if (span === 0) return 0;
    const raw =
      max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
    return (raw * 60 + 360) % 360;
  }

  const worst = (tokens: Record<string, string>, color: string) =>
    Math.min(...accentTextBackdrops(tokens).map((b) => contrastRatio(color, b.color) ?? 21));

  const lightTheme = (accent: string) =>
    minimalTheme({
      mode: 'light',
      tokens: {
        ...minimalTheme().tokens,
        '--bg': '#ffffff',
        '--surface': '#ffffff',
        '--surface-2': '#f3f4f6',
        '--text': '#111827',
        '--text-muted': '#4b5563',
        '--border': '#e5e7eb',
        '--accent': accent,
        '--accent-soft': `${accent}1a`,
      },
    }) as ThemeFile;

  it('derives a readable, same-hue colour for a light theme whose accent fails', () => {
    const theme = lightTheme('#14b8a6');
    const accent = '#14b8a6';
    expect(worst(theme.tokens, accent)).toBeLessThan(4.5);

    const text = resolveTheme(theme).tokens['--accent-text'] ?? '';

    expect(text).not.toBe(accent);
    expect(worst(resolveTheme(theme).tokens, text)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hue(text) - hue(accent))).toBeLessThan(1);
  });

  it('derives a readable, same-hue colour for a dark theme whose accent fails', () => {
    const accent = '#7c3aed';
    const theme = minimalTheme({
      tokens: { ...minimalTheme().tokens, '--accent': accent, '--accent-soft': `${accent}1f` },
    }) as ThemeFile;
    expect(worst(theme.tokens, accent)).toBeLessThan(4.5);

    const text = resolveTheme(theme).tokens['--accent-text'] ?? '';

    expect(worst(resolveTheme(theme).tokens, text)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hue(text) - hue(accent))).toBeLessThan(1);
    // Lighter in a dark theme, not darker.
    expect(contrastRatio(text, '#ffffff')).toBeLessThan(contrastRatio(accent, '#ffffff') ?? 0);
  });

  it('keeps an accent that already reads, exactly', () => {
    const theme = resolveTheme(minimalTheme() as ThemeFile);
    expect(theme.tokens['--accent-text']).toBe('#5eead4');
  });

  it('never overrides an authored value', () => {
    const theme = minimalTheme();
    theme.tokens['--accent-text'] = '#a7f3d0';
    expect(resolveTheme(theme as ThemeFile).tokens['--accent-text']).toBe('#a7f3d0');
  });

  it('changes only Daybreak and Tokyo among the bundled themes', () => {
    const changed = BUNDLED_THEMES.filter(
      (theme) => theme.tokens['--accent-text'] !== theme.tokens['--accent'],
    ).map((theme) => theme.id);
    expect(changed.sort()).toEqual(['daybreak', 'tokyo']);
  });

  it('checks secondary text on every surface, panels included', () => {
    const tokens = resolveTheme(
      minimalTheme({
        tokens: { ...minimalTheme().tokens, '--surface-2': '#4a4a5c' },
      }) as ThemeFile,
    ).tokens;
    expect(contrastWarnings(tokens)).toEqual([
      expect.stringMatching(/^--text-muted on --surface-2 has contrast/),
    ]);
  });

  it('measures translucent text as it renders, over its backdrop', () => {
    // 10% black over white renders near white: about 1.2:1, not black's 21:1.
    const theme = minimalTheme({
      mode: 'light',
      tokens: {
        ...minimalTheme().tokens,
        '--bg': '#ffffff',
        '--surface': '#ffffff',
        '--surface-2': '#f3f4f6',
        '--text': '#111827',
        '--text-muted': 'rgba(17, 24, 39, 0.3)',
        '--accent': '#0f766e',
        '--accent-soft': 'rgba(15, 118, 110, 0.1)',
        '--accent-text': 'rgba(0, 0, 0, 0.1)',
      },
    }) as ThemeFile;

    const warnings = contrastWarnings(resolveTheme(theme).tokens);

    expect(warnings).toContainEqual(
      expect.stringMatching(/^--accent-text on --bg has contrast 1\./),
    );
    expect(warnings).toContainEqual(expect.stringMatching(/^--text-muted on --bg has contrast/));
  });

  it('derives from a translucent accent as it renders, not as if it were opaque', () => {
    // Opaque, this teal reads on white; at 30% it does not, so it is stepped.
    const theme = minimalTheme({
      mode: 'light',
      tokens: {
        ...minimalTheme().tokens,
        '--bg': '#ffffff',
        '--surface': '#ffffff',
        '--surface-2': '#ffffff',
        '--text': '#111827',
        '--text-muted': '#4b5563',
        '--accent': 'rgba(15, 118, 110, 0.3)',
        '--accent-soft': 'rgba(15, 118, 110, 0.1)',
      },
    }) as ThemeFile;

    const resolved = resolveTheme(theme).tokens;

    expect(resolved['--accent-text']).not.toBe('rgba(15, 118, 110, 0.3)');
    expect(contrastWarnings(resolved)).toEqual([]);
  });

  it('checks accent text on the veil a theme actually gets, authored or not', () => {
    // A light theme with no --screen-veil of its own: the screensaver's
    // attribution (.nott__author) still sits on a veil, so the veil it gets
    // must be among the backdrops, and must be a light one.
    const theme = minimalTheme({
      mode: 'light',
      tokens: {
        ...minimalTheme().tokens,
        '--bg': '#fbfaf7',
        '--surface': '#ffffff',
        '--surface-2': '#f3f1ec',
        '--text': '#1f2430',
        '--text-muted': '#5b6070',
        '--accent': '#0f6b63',
        '--accent-soft': 'rgba(15, 107, 99, 0.1)',
      },
    }) as ThemeFile;

    const tokens = resolveTheme(theme).tokens;
    const veil = accentTextBackdrops(tokens).find(
      (backdrop) => backdrop.label === '--screen-veil over --bg',
    );

    expect(veil).toBeDefined();
    expect(tokens['--screen-veil']).toBe('rgba(251, 250, 247, 0.95)');
    expect(contrastWarnings(tokens)).toEqual([]);
  });

  it('flags accent text on an authored veil it cannot be read on', () => {
    const tokens = resolveTheme(
      minimalTheme({
        mode: 'light',
        tokens: {
          ...minimalTheme().tokens,
          '--bg': '#ffffff',
          '--surface': '#ffffff',
          '--surface-2': '#f3f4f6',
          '--text': '#111827',
          '--text-muted': '#4b5563',
          '--accent': '#0f6b63',
          '--accent-soft': 'rgba(15, 107, 99, 0.1)',
          '--screen-veil': 'rgba(6, 8, 14, 0.96)',
        },
      }) as ThemeFile,
    ).tokens;

    expect(contrastWarnings(tokens)).toContainEqual(
      expect.stringMatching(/^--accent-text on --screen-veil over --bg has contrast/),
    );
  });

  it("makes the stylesheet's default veils explicit, so no shipped theme changes", () => {
    const veil = (id: string) =>
      BUNDLED_THEMES.find((entry) => entry.id === id)?.tokens['--screen-veil'];
    // tokens.css: :root (Aurora, and every dark theme without one) and Daybreak's block.
    expect(veil('aurora')).toBe('rgba(6, 8, 14, 0.96)');
    expect(veil('daybreak')).toBe('rgba(250, 247, 241, 0.95)');
  });

  it('flags invisible text: transparent reads as its backdrop', () => {
    const theme = minimalTheme();
    theme.tokens['--accent-text'] = 'transparent';

    const warnings = contrastWarnings(resolveTheme(theme as ThemeFile).tokens);

    expect(warnings).toContainEqual(
      expect.stringMatching(/^--accent-text on --bg has contrast 1\.00:1/),
    );
  });

  it('flags a colour the contrast check cannot read, rather than skipping it', () => {
    // The schema rejects these; the lint must not pass them on its own either.
    const theme = minimalTheme();
    Object.assign(theme.tokens, { '--text-muted': 'rgb(55, 56)', '--surface-2': 'hsl(0, 0%, 9%)' });

    const warnings = contrastWarnings(resolveTheme(theme as ThemeFile).tokens);

    expect(warnings).toContainEqual(expect.stringContaining('--text-muted is rgb(55, 56), which'));
    expect(warnings).toContainEqual(
      expect.stringContaining('--surface-2 is hsl(0, 0%, 9%), which'),
    );
  });

  it('flags text that fails on --accent-soft alone', () => {
    // Readable on all three surfaces, unreadable on a heavy accent tint.
    const tokens = resolveTheme(
      minimalTheme({
        tokens: {
          ...minimalTheme().tokens,
          '--accent-soft': 'rgba(94, 234, 212, 0.5)',
          '--accent-text': '#4fb3a5',
        },
      }) as ThemeFile,
    ).tokens;

    const warnings = contrastWarnings(tokens);

    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings)
      expect(warning).toMatch(/^--accent-text on --accent-soft over /);
  });

  it('flags text that fails on --surface-2 alone (Tokyo before PLAN-40, the Heimdall brand)', () => {
    const tokens = resolveTheme(
      minimalTheme({
        tokens: {
          ...minimalTheme().tokens,
          '--surface-2': '#2c3e57',
          '--accent': '#ff006e',
          '--accent-soft': 'rgba(255, 0, 110, 0.12)',
          '--accent-text': '#ff66a8',
        },
      }) as ThemeFile,
    ).tokens;

    const warnings = contrastWarnings(tokens);

    expect(warnings).toContainEqual(
      expect.stringMatching(/^--accent-text on --surface-2 has contrast/),
    );
    for (const warning of warnings) expect(warning).toMatch(/--surface-2 has contrast/);
  });

  it('gives up past its step limit and names the token to author', () => {
    // A mid-grey panel: no blue within reach of the limit reads on it.
    const theme = minimalTheme({
      tokens: { ...minimalTheme().tokens, '--surface-2': '#8a8a8a', '--accent': '#3b82f6' },
    }) as ThemeFile;

    const resolved = resolveTheme(theme);

    expect(ACCENT_TEXT_MAX_STEPS * ACCENT_TEXT_STEP).toBeLessThan(0.5);
    expect(resolved.tokens['--accent-text']).toBe('#3b82f6');
    expect(contrastWarnings(resolved.tokens)).toContainEqual(
      expect.stringContaining('Author a readable --accent-text in the theme'),
    );
  });

  it("gives the stylesheet's first-paint defaults the derived values", () => {
    // tokens.css paints before the theme engine runs: Aurora on :root, and
    // Daybreak under its data-theme. Each must carry what resolveTheme derives.
    const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
    const block = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      return css.slice(start, css.indexOf('\n}', start));
    };
    const value = (text: string) => /--accent-text:\s*([^;]+);/.exec(text)?.[1];
    const theme = (id: string) => BUNDLED_THEMES.find((entry) => entry.id === id)?.tokens;
    expect(value(block(':root'))).toBe(theme('aurora')?.['--accent-text']);
    expect(value(block("[data-theme='daybreak']"))).toBe(theme('daybreak')?.['--accent-text']);
  });

  it('is what every stylesheet colours accent text with, never --accent itself', () => {
    const root = new URL('../../', import.meta.url);
    const sheets = (readdirSync(root, { recursive: true }) as string[]).filter((name) =>
      name.endsWith('.css'),
    );
    expect(sheets.length).toBeGreaterThan(5);
    const offenders = sheets.flatMap((name) =>
      readFileSync(new URL(name, root), 'utf8')
        .split('\n')
        .map((line, index) => ({ line, at: `${name}:${index + 1}` }))
        // `color:` itself, not border-color, accent-color and the rest.
        .filter(({ line }) => /(^|[\s;{])color:\s*var\(--accent\)/.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });
});
