/**
 * Colour parsing for the derived defaults, and the WCAG contrast lint. Ported
 * from the server (PLAN-35). The lint used to be a warning Heimdall showed;
 * now that themes are code, `themes.test.ts` fails CI instead. At runtime
 * `resolveTheme` uses the parsing, contrast and backdrop helpers to derive
 * `--accent-text` (PLAN-40); `contrastWarnings` itself stays test-only.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseColor(value: string): Rgb | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (hex?.[1]) {
    let digits = hex[1];
    if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value.trim());
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

export interface Rgba extends Rgb {
  /** 0..1 */
  a: number;
}

/** A colour with its alpha: `rgba()`'s fourth value, `#rrggbbaa`'s last pair, else 1. */
export function parseRgba(value: string): Rgba | null {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const trimmed = value.trim();
  const hexAlpha = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(trimmed)?.[1];
  if (hexAlpha) return { ...rgb, a: parseInt(hexAlpha, 16) / 255 };
  const fnAlpha = /^rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)(%?)\s*\)$/i.exec(trimmed);
  if (fnAlpha?.[1]) {
    const a = Number(fnAlpha[1]) / (fnAlpha[2] ? 100 : 1);
    return { ...rgb, a: Math.min(1, Math.max(0, a)) };
  }
  return { ...rgb, a: 1 };
}

export function toHex({ r, g, b }: Rgb): string {
  const pair = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

/**
 * `over` painted on the opaque `under`, as a browser composites it: per
 * channel, in sRGB. Null when either cannot be parsed.
 */
export function composite(over: string, under: string): string | null {
  const top = parseRgba(over);
  const base = parseColor(under);
  if (!top || !base) return null;
  const mix = (a: number, b: number) => top.a * a + (1 - top.a) * b;
  return toHex({ r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b) });
}

/**
 * `color` moved `amount` (0..1) of the way to `target`, per channel. Towards
 * white or black every channel's distance scales alike, so the hue is kept.
 */
export function mixToward(color: string, target: Rgb, amount: number): string | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const step = (from: number, to: number) => from + (to - from) * amount;
  return toHex({ r: step(rgb.r, target.r), g: step(rgb.g, target.g), b: step(rgb.b, target.b) });
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** WCAG contrast ratio 1..21, or null when either color can't be parsed. */
export function contrastRatio(a: string, b: string): number | null {
  const rgbA = parseColor(a);
  const rgbB = parseColor(b);
  if (!rgbA || !rgbB) return null;
  const la = relativeLuminance(rgbA);
  const lb = relativeLuminance(rgbB);
  const [dark, light] = la < lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

export const MIN_TEXT_CONTRAST = 4.5;

/**
 * Contrast of text as it renders on an opaque backdrop. A translucent colour
 * is composited over the backdrop first: `contrastRatio` reads only the RGB,
 * so 10% black over white would measure 21:1 while rendering about 1.2:1.
 */
export function textContrast(text: string, backdrop: string): number | null {
  return contrastRatio(composite(text, backdrop) ?? text, backdrop);
}

/**
 * The accent tints the CSS mixes from `--accent` itself, besides the theme's
 * own `--accent-soft` (`color-mix(in srgb, var(--accent) N%, transparent)`):
 * 10% behind Portkey's enchant note, 12% behind a chip that is on (Accio,
 * Nimbus), 14% behind the active tag suggestion. Each sits on the page or a
 * card, never on `--surface-2`.
 */
export const ACCENT_TINTS = [0.1, 0.12, 0.14] as const;

export interface Backdrop {
  /** How the lint names it: `--surface-2`, `--accent-soft over --bg`. */
  label: string;
  /** The opaque colour the text actually sits on. */
  color: string;
}

/** The first colour in a CSS value (a gradient's first stop), or null. */
function firstColor(value: string): string | null {
  return /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i.exec(value)?.[0] ?? null;
}

/**
 * Every backdrop accent-coloured text sits on (PLAN-40), from an inventory of
 * the 44 rules that colour text with it (`color: var(--accent-text)`), each
 * read against its own background or its nearest painted ancestor's:
 *
 * - `--bg`, the page: links (`a`, `.seo-static a`), the `.eyebrow`, Edda's
 *   reading outline, Nimbus's figures, a sky relic, and the header's veil
 *   (`--surface` at 0.78–0.82 over the page, so between the two).
 * - `--surface`, cards and sheets: Portkey's slug and link buttons, the Saga
 *   shortcuts card, Loki's sheet and output, the plist table, the tag
 *   suggestions, the file rows, Edda's outline, the Heimdall modal and its
 *   about links. A card's `--card-sheen` lightens its top in a dark theme, so
 *   its first stop over `--surface` is checked too.
 * - `--surface-2`, panels, code and chips: `.heimdall-brand` and the local
 *   note on `.heimdall-panel`, highlighted code in `pre` (`.md-preview`,
 *   `.preview-markdown`), the empty-state icon, plist rows on hover.
 * - `--accent-soft` over each of those: the active nav item, the Heimdall nav,
 *   Runestone's and Variant's view toggles, the active dropzone, an image
 *   file's icon, the armed Offline switch, a tone chip outside a card. It is
 *   translucent, so it is checked over every surface it can land on.
 * - Found by the inventory, outside that set: the `ACCENT_TINTS` over the
 *   page and over `--surface`, and the screensaver's `--screen-veil` over the
 *   page, behind `.nott__author` and its mark.
 *
 * Fills, borders and the bridge use `--accent` and need no text contrast.
 */
export function accentTextBackdrops(tokens: Record<string, string>): Backdrop[] {
  const named = (name: string): Backdrop | null => {
    const color = tokens[name];
    return color && parseColor(color) ? { label: name, color } : null;
  };
  const surfaces = ['--bg', '--surface', '--surface-2']
    .map(named)
    .filter((backdrop): backdrop is Backdrop => backdrop !== null);
  const over = (label: string, color: string, under: Backdrop): Backdrop | null => {
    const result = composite(color, under.color);
    return result ? { label: `${label} over ${under.label}`, color: result } : null;
  };
  const layered: (Backdrop | null)[] = [];
  const soft = tokens['--accent-soft'];
  if (soft) for (const surface of surfaces) layered.push(over('--accent-soft', soft, surface));
  const accent = parseColor(tokens['--accent'] ?? '');
  const pageAndCards = surfaces.filter((surface) => surface.label !== '--surface-2');
  if (accent) {
    for (const share of ACCENT_TINTS) {
      const tint = `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${share})`;
      for (const surface of pageAndCards) {
        layered.push(over(`--accent at ${Math.round(share * 100)}%`, tint, surface));
      }
    }
  }
  const card = surfaces.find((surface) => surface.label === '--surface');
  const sheen = firstColor(tokens['--card-sheen'] ?? '');
  if (card && sheen) layered.push(over('--card-sheen', sheen, card));
  const page = surfaces.find((surface) => surface.label === '--bg');
  const veil = tokens['--screen-veil'];
  if (page && veil) layered.push(over('--screen-veil', veil, page));
  return [...surfaces, ...layered.filter((backdrop): backdrop is Backdrop => backdrop !== null)];
}

export function contrastWarnings(tokens: Record<string, string>): string[] {
  const warnings: string[] = [];
  const pairs: [string, string][] = [
    ['--text', '--bg'],
    ['--text', '--surface'],
    // Secondary text sits on every surface, panels included (PLAN-40: Daybreak
    // and Tokyo fell short on --surface-2, and Daybreak on the page itself).
    ['--text-muted', '--bg'],
    ['--text-muted', '--surface'],
    ['--text-muted', '--surface-2'],
  ];
  for (const [fg, bg] of pairs) {
    const fgValue = tokens[fg];
    const bgValue = tokens[bg];
    if (!fgValue || !bgValue) continue;
    const ratio = textContrast(fgValue, bgValue);
    if (ratio !== null && ratio < MIN_TEXT_CONTRAST) {
      warnings.push(
        `${fg} on ${bg} has contrast ${ratio.toFixed(2)}:1 — below the ${MIN_TEXT_CONTRAST}:1 readability floor`,
      );
    }
  }
  // Accent-coloured text, wherever it sits. `resolveTheme` derives a value
  // that passes when it can; one that still fails here is a theme whose
  // accent could not be stepped far enough, or an authored value that falls
  // short, and the fix is the same: author a readable --accent-text.
  const accentText = tokens['--accent-text'];
  if (accentText) {
    for (const backdrop of accentTextBackdrops(tokens)) {
      const ratio = textContrast(accentText, backdrop.color);
      if (ratio !== null && ratio < MIN_TEXT_CONTRAST) {
        warnings.push(
          `--accent-text on ${backdrop.label} has contrast ${ratio.toFixed(2)}:1 — below the ` +
            `${MIN_TEXT_CONTRAST}:1 readability floor. Author a readable --accent-text in the theme`,
        );
      }
    }
  }
  return warnings;
}
