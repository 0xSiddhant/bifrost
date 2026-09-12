/**
 * Colour conversion and WCAG contrast for Iris (PLAN-18).
 *
 * The contrast maths is a deliberate second implementation of
 * `server/src/modules/themes/contrast.ts`, and is unit-tested against that
 * file's own vectors. PLAN-99's note said Iris could reuse it; it cannot — that
 * file is in the server workspace *and* inside a feature module, so it is
 * unreachable from the browser twice over. Introducing a shared workspace
 * package for forty lines of WCAG maths would cost more than the duplication.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

/** Accepts #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(). */
export function parseColour(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex?.[1]) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = [...digits].map((d) => d + d).join('');
    }
    if (digits.length !== 6 && digits.length !== 8) return null;
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgb?.[1]) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (raw: string) =>
      raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw);
    const [r, g, b, alpha] = [channel(parts[0] ?? ''), channel(parts[1] ?? ''), channel(parts[2] ?? ''), parts[3]];
    if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
    return {
      r: clamp(Math.round(r), 0, 255),
      g: clamp(Math.round(g), 0, 255),
      b: clamp(Math.round(b), 0, 255),
      a: alpha === undefined ? 1 : clamp(alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha), 0, 1),
    };
  }

  const hsl = /^hsla?\(([^)]+)\)$/.exec(value);
  if (hsl?.[1]) {
    const parts = hsl[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = Number.parseFloat(parts[0] ?? '');
    const s = Number.parseFloat(parts[1] ?? '') / 100;
    const l = Number.parseFloat(parts[2] ?? '') / 100;
    if (![h, s, l].every(Number.isFinite)) return null;
    const alpha = parts[3];
    return {
      ...hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)),
      a: alpha === undefined ? 1 : clamp(alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha), 0, 1),
    };
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): {
  h: number;
  s: number;
  l: number;
} {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
  else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
  else h = 60 * ((rn - gn) / delta + 4);
  return { h: ((h % 360) + 360) % 360, s, l };
}

export function toHex({ r, g, b, a }: Rgb): string {
  const pair = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const base = `#${pair(r)}${pair(g)}${pair(b)}`;
  return a >= 1 ? base : `${base}${pair(a * 255)}`;
}

export function toRgbString({ r, g, b, a }: Rgb): string {
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(a, 3)})`;
}

export function toHslString(rgb: Rgb): string {
  const { h, s, l } = rgbToHsl(rgb);
  const body = `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
  return rgb.a >= 1 ? `hsl(${body})` : `hsla(${body}, ${round(rgb.a, 3)})`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ── OKLCh ──────────────────────────────────────────────────────
// sRGB → linear → LMS → OKLab → OKLCh (Björn Ottosson's matrices).

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return clamp(Math.round(c * 255), 0, 255);
}

export function rgbToOklch({ r, g, b }: { r: number; g: number; b: number }): {
  l: number;
  c: number;
  h: number;
} {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.sqrt(A * A + B * B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

export function oklchToRgb(l: number, c: number, h: number): { r: number; g: number; b: number } {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  };
}

export function toOklchString(rgb: Rgb): string {
  const { l, c, h } = rgbToOklch(rgb);
  const body = `${round(l, 4)} ${round(c, 4)} ${round(h, 2)}`;
  return rgb.a >= 1 ? `oklch(${body})` : `oklch(${body} / ${round(rgb.a, 3)})`;
}

// ── WCAG ───────────────────────────────────────────────────────

export function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio 1..21, or null when either colour cannot be parsed. */
export function contrastRatio(a: string, b: string): number | null {
  const rgbA = parseColour(a);
  const rgbB = parseColour(b);
  if (!rgbA || !rgbB) return null;
  const la = relativeLuminance(rgbA);
  const lb = relativeLuminance(rgbB);
  const [dark, light] = la < lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

export interface WcagVerdict {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
}

export function wcagVerdict(ratio: number): WcagVerdict {
  return {
    ratio,
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5,
  };
}

// ── Palette extraction ─────────────────────────────────────────

/**
 * Dominant colours from raw RGBA pixels.
 *
 * A 4-bit-per-channel histogram (4096 buckets) rather than k-means: it is one
 * pass, deterministic, and the answer only has to be "the colours a person
 * would name in this photo". Near-transparent pixels are skipped because a
 * PNG's transparent margin is otherwise the most common "colour" in the file.
 */
export function extractPalette(pixels: Uint8ClampedArray, count = 6): string[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] ?? 0;
    if (alpha < 128) continue;
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, count)
    // Average within the bucket, so the swatch is a colour that was actually
    // in the image rather than the corner of its quantisation cell.
    .map((bucket) =>
      toHex({
        r: Math.round(bucket.r / bucket.count),
        g: Math.round(bucket.g / bucket.count),
        b: Math.round(bucket.b / bucket.count),
        a: 1,
      }),
    );
}

/**
 * A palette as a droppable `themes/<id>.json` starter (THEME-SPEC).
 *
 * Only the 14 required roles plus the ten card slots are emitted — everything
 * else in the spec is derived when omitted, and a starter that listed every
 * optional token would be a wall to edit rather than a beginning.
 *
 * The palette drives the **decorative** roles only: the two accents and the ten
 * positional card hues. `--ok`/`--danger`/`--warn` keep their semantic
 * defaults, because a photo has no opinion about which of its colours means
 * "this failed" — taking them by position produced a navy warning and a sandy
 * danger the first time this ran. Those are the ones to hand-pick afterwards.
 */
export function paletteToThemeJson(
  palette: string[],
  options: { id: string; name: string; mode: 'dark' | 'light' },
): string {
  const dark = options.mode === 'dark';
  const accent = palette[0] ?? (dark ? '#5eead4' : '#0f766e');
  const accent2 = palette[1] ?? (dark ? '#a78bfa' : '#6d28d9');
  const cards: Record<string, string> = {};
  for (let i = 0; i < 10; i += 1) {
    const colour = palette[i % Math.max(1, palette.length)];
    if (colour) cards[`--card-${i + 1}`] = colour;
  }
  return JSON.stringify(
    {
      id: options.id,
      name: options.name,
      mode: options.mode,
      tokens: {
        '--bg': dark ? '#0a0a12' : '#f7f7fb',
        '--surface': dark ? '#12121f' : '#ffffff',
        '--surface-2': dark ? '#1a1a2c' : '#eef0f6',
        '--text': dark ? '#e8e8f0' : '#16161d',
        '--text-muted': dark ? '#9a9ab0' : '#5a5a6e',
        '--border': dark ? '#2a2a3d' : '#d8dae4',
        '--accent': accent,
        '--accent-2': accent2,
        '--ok': dark ? '#4ade80' : '#15803d',
        '--danger': dark ? '#f87171' : '#b91c1c',
        '--warn': dark ? '#fbbf24' : '#b45309',
        '--accent-soft': `${accent}1f`,
        '--danger-soft': dark ? 'rgba(248, 113, 113, 0.14)' : 'rgba(185, 28, 28, 0.1)',
        '--scrim': dark ? 'rgba(4, 4, 10, 0.66)' : 'rgba(20, 20, 30, 0.38)',
        ...cards,
      },
    },
    null,
    2,
  );
}
