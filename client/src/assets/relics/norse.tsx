/**
 * Norse relics — faint line-art scattered in the sky for atmosphere.
 * Same stroke language as the UI icons; rendered at very low opacity.
 */
import { base, glyphRelic, type RelicProps } from './shared';

/** Mjölnir — Thor's hammer */
const Mjolnir = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6 4h12v7h-4v9h-4v-9H6V4z" />
    <path d="M9 4v3.5M15 4v3.5" />
  </svg>
);

/** Valknut — Odin's knot of the slain */
const Valknut = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3 6.5 12.5h11L12 3z" />
    <path d="M8.5 9 3 18.5h11L8.5 9z" />
    <path d="M15.5 9 10 18.5h11L15.5 9z" />
  </svg>
);

/** Huginn / Muninn — raven in flight */
const Raven = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3 14c3-1 5-3 6-6 1 2 3 3 6 3 2 0 4-.5 6-2-1 3-3 5-6 6l2 4-4-2c-3 1-7 0-10-3z" />
    <path d="M16 8.5v.01" />
  </svg>
);

/** Longship under sail */
const Longship = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3 15c2 2 5 3 9 3s7-1 9-3l-2 4H5l-2-4z" />
    <path d="M12 15V4" />
    <path d="M12 4c4 1 5 4 4 8H12" />
    <path d="M3 15c1-1 1.5-2.5 1-4" />
  </svg>
);

/** Drinking horn */
const Horn = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 4c6 0 13 2 14 8 .5 3-1 7-3 8-1-6-6-11-12-13L5 4z" />
    <path d="M6.5 6.5C11 8 15 12 16.5 17" />
  </svg>
);

/** Bearded axe */
const Axe = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="m7 21 9-13" />
    <path d="M13 4c2 3 5 4 8 3-1 4-4 7-8 7-1.5 0-2.5-.5-3.5-1.5C9 11 9 9 10 7.5 11 6 12 5 13 4z" />
  </svg>
);

/** Round shield with boss */
const Shield = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 3v7M12 14v7M3 12h7M14 12h7" />
  </svg>
);

/** Yggdrasil — the world tree */
const Yggdrasil = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 21V9" />
    <path d="M12 9C9 9 7 7 7 4c3 0 5 1.5 5 5 0-3.5 2-5 5-5 0 3-2 5-5 5z" />
    <path d="M12 13c-2 0-3.5-1-4-3M12 13c2 0 3.5-1 4-3" />
    <path d="M12 21c-2-1-4-1-5 0M12 21c2-1 4-1 5 0" />
  </svg>
);

/** Gungnir — Odin's spear */
const Gungnir = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="m4 20 12-12" />
    <path d="M14 5c1.5 2 3.5 3.5 6 4-2.5.5-4.5 2-6 4-.5-2.5-1.5-5-3-6.5L14 5z" />
  </svg>
);

const runeRelic = glyphRelic;

/** Helm of Awe — ægishjálmur, the circle of spoked wards */
const HelmOfAwe = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="2" />
    <path d="M12 10V3M12 14v7M10 12H3M14 12h7" />
    <path d="M10 4.5 12 3l2 1.5M10 19.5 12 21l-2-1.5m4 0L12 21l2-1.5M4.5 10 3 12l1.5 2M19.5 10 21 12l-1.5 2" />
    <path d="m7 7 3.5 3.5M17 7l-3.5 3.5M7 17l3.5-3.5M17 17l-3.5-3.5" />
  </svg>
);

/** Jörmungandr — the world serpent biting its tail */
const Jormungandr = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 4a8 8 0 1 1-8 8c0-2 1-4 3-5" />
    <path d="M7 7c-.5-1.5.5-3 2-3 1 0 2 .5 2 2l-2 1.5L7 7z" />
    <path d="M9.5 4.5v.01" />
  </svg>
);

/** Fenrir — the bound wolf */
const Fenrir = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 18c0-4 2-7 5-8L8 5l4 3 4-3-2 5c3 1 5 4 5 8" />
    <path d="M9 13v.01M15 13v.01" />
    <path d="M10 17c.5 1 1.2 1.5 2 1.5s1.5-.5 2-1.5" />
  </svg>
);

/** Odin's eye — the one given for wisdom */
const OdinsEye = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3 12c2.5-4 5.5-6 9-6s6.5 2 9 6c-2.5 4-5.5 6-9 6s-6.5-2-9-6z" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 3.5v2" />
  </svg>
);

/** Viking helmet */
const Helmet = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6 14c0-5 2.5-9 6-9s6 4 6 9" />
    <path d="M5 14h14v2c-2 1.5-4.5 2.5-7 2.5S7 17.5 5 16v-2z" />
    <path d="M12 5v13" />
  </svg>
);

export const NORSE_RELICS = [
  Mjolnir,
  Valknut,
  Raven,
  Longship,
  Horn,
  Axe,
  Shield,
  Yggdrasil,
  Gungnir,
  HelmOfAwe,
  Jormungandr,
  Fenrir,
  OdinsEye,
  Helmet,
  runeRelic('ᚦ'), // thurisaz — Thor
  runeRelic('ᛟ'), // othala — heritage
  runeRelic('ᚱ'), // raido — the journey
  runeRelic('ᛒ'), // berkana — bifrost's own mark
  runeRelic('ᚨ'), // ansuz — Odin's rune
  runeRelic('ᛗ'), // mannaz — humankind
] as const;
