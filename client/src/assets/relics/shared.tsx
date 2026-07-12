import type { SVGProps } from 'react';

export type RelicProps = SVGProps<SVGSVGElement>;

/** Shared stroke language for all relics — matches the UI icon set. */
export function base(rest: RelicProps): SVGProps<SVGSVGElement> {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.1,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  };
}

/** Relic made of a single glyph (runes, platform numbers, …). */
export function glyphRelic(glyph: string, fontSize = 16) {
  const GlyphRelic = (p: RelicProps) => (
    <svg {...base(p)}>
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize={fontSize}
        stroke="none"
        fill="currentColor"
        opacity="0.9"
      >
        {glyph}
      </text>
    </svg>
  );
  return GlyphRelic;
}
