/**
 * WCAG contrast lint. Warn, never block (PLAN-04): a theme with unreadable
 * text still loads — Heimdall surfaces the warnings to the owner.
 */

interface Rgb {
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

const MIN_TEXT_CONTRAST = 4.5;

export function contrastWarnings(tokens: Record<string, string>): string[] {
  const warnings: string[] = [];
  const pairs: [string, string][] = [
    ['--text', '--bg'],
    ['--text', '--surface'],
  ];
  for (const [fg, bg] of pairs) {
    const fgValue = tokens[fg];
    const bgValue = tokens[bg];
    if (!fgValue || !bgValue) continue;
    const ratio = contrastRatio(fgValue, bgValue);
    if (ratio !== null && ratio < MIN_TEXT_CONTRAST) {
      warnings.push(
        `${fg} on ${bg} has contrast ${ratio.toFixed(2)}:1 — below the ${MIN_TEXT_CONTRAST}:1 readability floor`,
      );
    }
  }
  return warnings;
}
