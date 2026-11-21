import { contrastRatio, parseRgba, toHex } from '../../core/theme/color';

/**
 * How Nótt paints on its veil. The overlay was drawn for a night sky: pale
 * stars at low opacity and faint constellation lines read against near-black,
 * and the near "suns" glow through a canvas shadow. On a light theme's veil
 * (Yule's frost, Daybreak's parchment) the same numbers all but vanish, and
 * the shadow glow turns to a grey smudge. So a light veil gets "ink": far
 * stars kept visible, lines drawn bolder, every dot a touch larger, and the
 * suns' glow drawn as a soft halo instead of a shadow. A dark veil keeps
 * exactly the numbers it always had.
 */
export interface PaintStyle {
  /** True when the veil is light and the overlay draws in ink. */
  ink: boolean;
  /** Multiplies a link's strength into its opacity. */
  lineAlpha: number;
  lineWidth: number;
  /** A particle's opacity from its depth-scaled base. */
  particleAlpha: (base: number) => number;
  /** Multiplies every particle's radius. */
  sizeScale: number;
}

const NIGHT: PaintStyle = {
  ink: false,
  lineAlpha: 0.35,
  lineWidth: 1,
  particleAlpha: (base) => base,
  sizeScale: 1,
};

const INK: PaintStyle = {
  ink: true,
  lineAlpha: 0.8,
  lineWidth: 1.25,
  // The far stars start at 0.22: lifted to about 0.55, the near suns at 1.
  particleAlpha: (base) => Math.min(1, 0.3 + base * 1.1),
  sizeScale: 1.2,
};

let cached: { veil: string; style: PaintStyle } | null = null;

/**
 * Light when black text would read better on the veil than white. Asked on
 * every frame, so the answer is kept until the veil changes (a theme switch).
 */
export function paintStyle(veil: string): PaintStyle {
  if (cached?.veil === veil) return cached.style;
  const rgba = parseRgba(veil);
  let style = NIGHT;
  if (rgba) {
    const hex = toHex(rgba);
    const onBlack = contrastRatio(hex, '#000000') ?? 0;
    const onWhite = contrastRatio(hex, '#ffffff') ?? 0;
    if (onBlack > onWhite) style = INK;
  }
  cached = { veil, style };
  return style;
}
