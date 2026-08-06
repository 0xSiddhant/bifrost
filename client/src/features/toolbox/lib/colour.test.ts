import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  extractPalette,
  oklchToRgb,
  paletteToThemeJson,
  parseColour,
  hslToRgb,
  rgbToHsl,
  rgbToOklch,
  toHex,
  toHslString,
  toOklchString,
  toRgbString,
  wcagVerdict,
} from './colour';

describe('parseColour', () => {
  it('reads every hex length', () => {
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColour('#00ff0080')?.a).toBeCloseTo(0.502, 2);
    expect(parseColour('#f00f')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('reads rgb() and hsl(), with or without alpha', () => {
    expect(parseColour('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColour('rgba(0, 0, 255, 0.5)')).toEqual({ r: 0, g: 0, b: 255, a: 0.5 });
    expect(parseColour('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColour('hsl(120 100% 50%)')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
  });

  it('rejects nonsense', () => {
    for (const bad of ['', 'nope', '#gg0000', '#12345', 'rgb(1, 2)']) {
      expect(parseColour(bad)).toBeNull();
    }
  });
});

describe('conversions round-trip', () => {
  const samples = ['#000000', '#ffffff', '#ff0000', '#5eead4', '#a78bfa', '#123456', '#7f7f7f'];

  it('hex → hsl → hex, within the rounding the display format costs', () => {
    // toHslString rounds to whole degrees/percents because that is what people
    // copy into a stylesheet — so the round trip is within a unit or two per
    // channel, not exact. The lossless path is rgbToHsl/hslToRgb below.
    for (const hex of samples) {
      const rgb = parseColour(hex);
      if (!rgb) throw new Error(hex);
      const back = parseColour(toHslString(rgb));
      if (!back) throw new Error(hex);
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(2);
    }
  });

  it('hsl → rgb → hsl is exact when nothing is rounded for display', () => {
    for (const hex of samples) {
      const rgb = parseColour(hex);
      if (!rgb) throw new Error(hex);
      const { h, s, l } = rgbToHsl(rgb);
      const back = hslToRgb(h, s, l);
      expect(back).toEqual({ r: rgb.r, g: rgb.g, b: rgb.b });
    }
  });

  it('hex → oklch → hex, within a rounding step', () => {
    for (const hex of samples) {
      const rgb = parseColour(hex);
      if (!rgb) throw new Error(hex);
      const { l, c, h } = rgbToOklch(rgb);
      const back = oklchToRgb(l, c, h);
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
    }
  });

  it('places the OKLCh anchors where the spec says they are', () => {
    const white = rgbToOklch({ r: 255, g: 255, b: 255 });
    expect(white.l).toBeCloseTo(1, 2);
    expect(white.c).toBeCloseTo(0, 2);
    const black = rgbToOklch({ r: 0, g: 0, b: 0 });
    expect(black.l).toBeCloseTo(0, 3);
    // Pure red sits near L 0.628, C 0.258, h 29.2 — the published reference.
    const red = rgbToOklch({ r: 255, g: 0, b: 0 });
    expect(red.l).toBeCloseTo(0.628, 2);
    expect(red.c).toBeCloseTo(0.258, 2);
    expect(red.h).toBeCloseTo(29.2, 0);
  });

  it('formats each notation, carrying alpha only when there is some', () => {
    const opaque = parseColour('#ff0000');
    const faded = parseColour('rgba(255, 0, 0, 0.5)');
    if (!opaque || !faded) throw new Error('parse');
    expect(toRgbString(opaque)).toBe('rgb(255, 0, 0)');
    expect(toRgbString(faded)).toBe('rgba(255, 0, 0, 0.5)');
    expect(toHslString(opaque)).toBe('hsl(0, 100%, 50%)');
    expect(toOklchString(opaque)).toMatch(/^oklch\(/);
    expect(toOklchString(faded)).toMatch(/ \/ 0\.5\)$/);
    expect(toHex(faded)).toBe('#ff000080');
  });

  it('reports greys as zero-saturation rather than a stray hue', () => {
    expect(rgbToHsl({ r: 127, g: 127, b: 127 })).toMatchObject({ h: 0, s: 0 });
  });
});

describe('contrastRatio — the same vectors as the server theme lint', () => {
  it('matches themes/theme-validation.test.ts', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 1);
  });

  it('is symmetric and bounded', () => {
    const a = contrastRatio('#5eead4', '#0a0a12') as number;
    const b = contrastRatio('#0a0a12', '#5eead4') as number;
    expect(a).toBeCloseTo(b, 10);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(21);
  });

  it('returns null when a colour cannot be parsed', () => {
    expect(contrastRatio('#000', 'not-a-colour')).toBeNull();
  });

  it('grades against the WCAG thresholds', () => {
    expect(wcagVerdict(21)).toMatchObject({ aaNormal: true, aaaNormal: true });
    expect(wcagVerdict(4.5)).toMatchObject({ aaNormal: true, aaaNormal: false, aaLarge: true });
    expect(wcagVerdict(3)).toMatchObject({ aaNormal: false, aaLarge: true });
    expect(wcagVerdict(1.4)).toMatchObject({ aaNormal: false, aaLarge: false, aaaLarge: false });
  });
});

describe('extractPalette', () => {
  /** Build RGBA pixel data from a list of [r,g,b,a,repeat] tuples. */
  const pixels = (spec: Array<[number, number, number, number, number]>) => {
    const out: number[] = [];
    for (const [r, g, b, a, times] of spec) {
      for (let i = 0; i < times; i += 1) out.push(r, g, b, a);
    }
    return new Uint8ClampedArray(out);
  };

  it('returns the dominant colours, most common first', () => {
    const data = pixels([
      [255, 0, 0, 255, 10],
      [0, 255, 0, 255, 5],
      [0, 0, 255, 255, 1],
    ]);
    expect(extractPalette(data, 3)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });

  it('skips near-transparent pixels — a PNG margin is not a colour', () => {
    const data = pixels([
      [0, 0, 0, 0, 100],
      [255, 0, 0, 255, 3],
    ]);
    expect(extractPalette(data, 3)).toEqual(['#ff0000']);
  });

  it('merges near-identical shades into one swatch', () => {
    const data = pixels([
      [250, 2, 2, 255, 4],
      [252, 0, 0, 255, 4],
      [0, 0, 255, 255, 1],
    ]);
    const palette = extractPalette(data, 5);
    expect(palette).toHaveLength(2);
    // The swatch is the bucket's average — (251, 1, 1) — not a cell corner.
    expect(palette[0]).toBe('#fb0101');
  });

  it('honours the requested count and copes with no pixels at all', () => {
    const data = pixels([
      [1, 1, 1, 255, 1],
      [40, 40, 40, 255, 1],
      [80, 80, 80, 255, 1],
    ]);
    expect(extractPalette(data, 2)).toHaveLength(2);
    expect(extractPalette(new Uint8ClampedArray([]), 5)).toEqual([]);
  });
});

describe('paletteToThemeJson', () => {
  it('emits the 14 required roles plus ten card slots', () => {
    const json = JSON.parse(
      paletteToThemeJson(['#112233', '#445566', '#778899'], {
        id: 'sunset',
        name: 'Sunset',
        mode: 'dark',
      }),
    );
    expect(json).toMatchObject({ id: 'sunset', name: 'Sunset', mode: 'dark' });
    for (const token of [
      '--bg', '--surface', '--surface-2', '--text', '--text-muted', '--border',
      '--accent', '--accent-2', '--ok', '--danger', '--warn',
      '--accent-soft', '--danger-soft', '--scrim',
    ]) {
      expect(json.tokens[token]).toBeTruthy();
    }
    for (let i = 1; i <= 10; i += 1) expect(json.tokens[`--card-${i}`]).toMatch(/^#/);
  });

  it('drives the accents from the extracted palette', () => {
    const json = JSON.parse(
      paletteToThemeJson(['#112233', '#445566'], { id: 'x', name: 'X', mode: 'light' }),
    );
    expect(json.tokens['--accent']).toBe('#112233');
    expect(json.tokens['--accent-2']).toBe('#445566');
    expect(json.tokens['--bg']).toBe('#f7f7fb');
  });

  it('still produces a valid starter from a single-colour palette', () => {
    const json = JSON.parse(
      paletteToThemeJson(['#112233'], { id: 'x', name: 'X', mode: 'dark' }),
    );
    expect(json.tokens['--card-1']).toBe('#112233');
    expect(json.tokens['--card-10']).toBe('#112233');
    expect(json.tokens['--accent-2']).toBeTruthy();
  });
});
