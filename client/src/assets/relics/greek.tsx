/**
 * Olympus relics — Greek mythology, the Norse world's sibling pantheon.
 * Same faint line-art language as the other collections.
 */
import { base, glyphRelic, type RelicProps } from './shared';

/** Poseidon's trident */
const Trident = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 21V6" />
    <path d="M12 6c0-1.5.8-2.5 2-3M12 6c0-1.5-.8-2.5-2-3" />
    <path d="M7 5v3c0 2 2 3.5 5 3.5S17 10 17 8V5" />
    <path d="M7 5l-1-1.5M17 5l1-1.5" />
  </svg>
);

/** Apollo's lyre */
const Lyre = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M7 3c-1 4-1 8 1 10M17 3c1 4 1 8-1 10" />
    <path d="M8 13c1 1 2.5 1.5 4 1.5s3-.5 4-1.5" />
    <path d="M10 5.5v8M12 6v8.5M14 5.5v8" />
    <path d="M12 14.5V21M9 21h6" />
  </svg>
);

/** Laurel wreath */
const Laurel = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 5c-1 5 1 11 7 14 6-3 8-9 7-14" />
    <path d="M6 9c1.5 0 2.5-1 2.5-2.5C7 6.5 6 7.5 6 9zM7.5 13c1.5-.3 2.3-1.4 2-2.9-1.6.3-2.4 1.4-2 2.9zM10 16.5c1.4-.6 1.9-1.8 1.3-3.2-1.5.6-2 1.8-1.3 3.2z" />
    <path d="M18 9c-1.5 0-2.5-1-2.5-2.5C17 6.5 18 7.5 18 9zM16.5 13c-1.5-.3-2.3-1.4-2-2.9 1.6.3 2.4 1.4 2 2.9zM14 16.5c-1.4-.6-1.9-1.8-1.3-3.2 1.5.6 2 1.8 1.3 3.2z" />
  </svg>
);

/** Hermes' winged sandal */
const WingedSandal = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 17c4 0 8-.5 11-2l3 2c-2 2.5-6 4-14 3v-3z" />
    <path d="M16 15c1-2 1-4 0-6" />
    <path d="M15 9c-2-2-4.5-2.5-7-1.5 1 1.5 2.5 2.5 4.5 2.5M14 12c-2-1-4-1-6 0 1 1 2.5 1.5 4 1.2" />
  </svg>
);

/** Caduceus */
const Caduceus = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 21V7" />
    <circle cx="12" cy="4.5" r="1.5" />
    <path d="M8 8c2 1.5 6 1.5 8 0M8 12c2 1.5 6 1.5 8 0M8 8c-1.5-1-1.5-2.5 0-3M16 8c1.5-1 1.5-2.5 0-3" />
    <path d="M8 12c-1.5-1-1.5-2.5 0-3.5M16 12c1.5-1 1.5-2.5 0-3.5" />
  </svg>
);

/** Doric column */
const Column = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 4h14M6 6h12M7 6v12M10 6v12M14 6v12M17 6v12M6 18h12M5 20h14" />
  </svg>
);

/** Amphora */
const Amphora = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M10 3h4M11 3v2h2V3" />
    <path d="M9 5c-2 3-2 7 0 10 1 1.5 1 3-1 5h8c-2-2-2-3.5-1-5 2-3 2-7 0-10" />
    <path d="M9 6C7.5 6 6.5 7 6.5 8.5M15 6c1.5 0 2.5 1 2.5 2.5" />
    <path d="M9.5 9h5" />
  </svg>
);

/** Corinthian helmet */
const CorinthianHelmet = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6 13c0-5 2.5-8 6-8s6 3 6 8v6c-1.5-1-2.5-2.5-2.5-4v-2M6 13v6c1.5-1 2.5-2.5 2.5-4v-2" />
    <path d="M8.5 13h2.5v3M15.5 13H13v3" />
    <path d="M12 5V3.5c2 0 3.5.5 4.5 1.5" />
  </svg>
);

/** The labyrinth of the Minotaur */
const Labyrinth = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 12v-2h4v4H8V8h8" />
    <path d="M6 16V6h12v10h-4" />
    <path d="M4 18V4h16v14" />
  </svg>
);

/** Zeus' thunder — twin bolts crossed */
const TwinBolts = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M9 3 5 11h3l-2 7 5-8H8l1-7z" />
    <path d="m17 6-3 6h2.5L15 18l4-6h-2.5l.5-6z" />
  </svg>
);

/** Pegasus wing */
const Wing = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3 17C6 8 13 4 21 5c-1 2-2.5 3.5-4.5 4.5 0 0-1 4-4 5.5 0 0-2 3-6 3.5L3 17z" />
    <path d="M16.5 9.5c-3 .5-5.5 2-7.5 4.5" />
  </svg>
);

export const GREEK_RELICS = [
  Trident,
  Lyre,
  Laurel,
  WingedSandal,
  Caduceus,
  Column,
  Amphora,
  CorinthianHelmet,
  Labyrinth,
  TwinBolts,
  Wing,
  glyphRelic('Ω'), // omega
  glyphRelic('Δ'), // delta
  glyphRelic('Ψ'), // psi
] as const;
