/**
 * Ghibli-world relics — original line art in the spirit of Studio Ghibli's
 * films: forest spirits, soot sprites, cozy objects and things that fly.
 * Same faint stroke language as the other collections (not character replicas).
 */
import { base, glyphRelic, type RelicProps } from './shared';

/** A small rounded forest spirit */
const ForestSpirit = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M9.5 6 8 3.2M14.5 6 16 3.2" />
    <path d="M6 13c0-4 2.7-7 6-7s6 3 6 7v2c0 2.4-2.7 4-6 4s-6-1.6-6-4v-2z" />
    <circle cx="9.8" cy="12" r=".7" />
    <circle cx="14.2" cy="12" r=".7" />
    <path d="M10 15.2l.7.9.7-.9M12.6 15.2l.7.9.7-.9" />
  </svg>
);

/** A soot sprite */
const SootSprite = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 6.5c-3.1 0-5.5 2.2-5.5 5S8.9 16.5 12 16.5s5.5-2.2 5.5-5S15.1 6.5 12 6.5z" />
    <path d="M12 6.5v-2M8.3 7.4 7 5.6M15.7 7.4 17 5.6M6.6 9.6 4.9 8.8M17.4 9.6l1.7-.8M6.6 13.4 4.9 14.2M17.4 13.4l1.7.8" />
    <circle cx="10.6" cy="11.4" r=".7" />
    <circle cx="13.4" cy="11.4" r=".7" />
    <path d="M9.5 17l1 2M14.5 17l-1 2" />
  </svg>
);

/** Acorn */
const Acorn = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 5V3.4" />
    <path d="M7 8.5c0-1.6 2.2-2.8 5-2.8s5 1.2 5 2.8c0 .7-.5 1.2-1.2 1.2H8.2C7.5 9.7 7 9.2 7 8.5z" />
    <path d="M8.2 9.7c.5 4 1.9 8.3 3.8 8.3s3.3-4.3 3.8-8.3" />
    <path d="M8.5 7.6h7" />
  </svg>
);

/** A single leaf */
const Leaf = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 19C5 11 10 5 19 5c0 8-5 14-14 14z" />
    <path d="M12 12 5 19M12 12c1.4-.9 3-1.4 5-1.5M12 12c-.5-1.6-.5-3.3 0-5" />
  </svg>
);

/** A leaf-parasol / umbrella */
const Umbrella = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3.5 12c1.3-4.7 4.6-7.5 8.5-7.5S19.2 7.3 20.5 12H3.5z" />
    <path d="M12 4.5V3M8 12c0-3 1.3-6 4-7.5M16 12c0-3-1.3-6-4-7.5" />
    <path d="M12 12v6.3a2 2 0 0 1-3.2.2" />
  </svg>
);

/** A little flame spirit */
const FlameSpirit = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3c3 3 5 5.5 5 9 0 3.3-2.2 5.5-5 5.5S7 15.3 7 12c0-2 .8-3.6 2-5 .3 1 .8 1.7 1.5 2C11 7 11 5 12 3z" />
    <circle cx="10.5" cy="12" r=".7" />
    <circle cx="13.5" cy="12" r=".7" />
    <path d="M10.4 14.4c.9.8 2.3.8 3.2 0" />
    <path d="M8.5 20c1-.8 2-.8 3 0M12.5 20c1-.8 2-.8 3 0" />
  </svg>
);

/** A tree spirit with a round head */
const TreeSpirit = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4.6" />
    <circle cx="10.3" cy="7.4" r=".9" />
    <circle cx="13.7" cy="7.4" r=".9" />
    <circle cx="12" cy="10" r=".7" />
    <path d="M9.4 12.2c-.4 2.8 0 5.4 2.6 7 2.6-1.6 3-4.2 2.6-7" />
    <path d="M9.7 15h4.6" />
  </svg>
);

/** Feather */
const Feather = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M18 5c-6 0-11 3.5-13 10l1 2 2 1c6.5-2 10-7 10-13z" />
    <path d="M7 18 17 8M9 14l3 .5M11 11l3 .5M13 8.5l2.5.5" />
  </svg>
);

/** A paper glider */
const PaperPlane = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M21 4 3 11l7 2 2 7 9-16z" />
    <path d="M10 13 21 4" />
  </svg>
);

/** A round goldfish */
const Goldfish = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M14 12c0-3.3-2.7-5.5-6-5.5S2.5 8.7 2.5 12s2.2 5.5 5.5 5.5 6-2.2 6-5.5z" />
    <path d="M14 12l4.5-3.2v6.4L14 12z" />
    <circle cx="6" cy="10.5" r=".7" />
    <path d="M4.2 13.2c1 .9 2.4 1.1 3.8.6" />
  </svg>
);

/** A whimsical walking castle */
const WalkingCastle = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6 20v-8l2-1.5V8l3-1 1 1.5 2-1v3l3 1.5V20" />
    <path d="M9 20v-4h3v4" />
    <path d="M7 14h2M15 12.5h2" />
    <path d="M13 6.5V4l1.6.8" />
    <path d="M6.5 20 5 21.5M17.5 20l1.5 1.5" />
  </svg>
);

/** A river dragon */
const Dragon = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3 17c2.5-.5 3.7-2.2 3-4.5-.5-1.7-2-2.3-1.5-4C5 6.8 7 6 9 6.8c1.6.7 1.7 2.5 3.7 2.7 2 .2 3-1.5 5.3-1 1.8.4 2.3 2.3 1 3.5" />
    <path d="M17.5 9.5c1.3-.5 2.5.2 2.5 1.6 0 1-.8 1.7-1.8 1.6" />
    <circle cx="18.7" cy="10.5" r=".5" />
    <path d="M16.6 7.6 18 6.2M19.2 8.2l1.3-.9" />
    <path d="M6.6 12.6c-1 .2-1.8-.3-2-1.3M9.6 8.4c-.9-.5-1.1-1.4-.5-2.2" />
  </svg>
);

/** A cozy teapot */
const Teapot = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M7 15c-1.7-1-2.5-2.5-2.5-4 0-3 3-5 7.5-5s7.5 2 7.5 5c0 1.5-.8 3-2.5 4" />
    <path d="M7 15h10l-1 2H8l-1-2z" />
    <path d="M12 6V4M10.5 4h3" />
    <path d="M4.5 11C3 11 2.6 12 3.1 13.2" />
    <path d="M19.5 10c1.5.3 2 1.5 1.3 2.7" />
  </svg>
);

/** A hanging paper lantern */
const Lantern = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3v2M9 5h6" />
    <path d="M8 6c-1 3-1 6 0 9 1.3.8 2.6 1.2 4 1.2s2.7-.4 4-1.2c1-3 1-6 0-9-1.3-.8-2.6-1.2-4-1.2S9.3 5.2 8 6z" />
    <path d="M8.4 9h7.2M8.4 12h7.2" />
    <path d="M11 16.4h2v2h-2z" />
  </svg>
);

/** A gust of wind */
const WindSwirl = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M4 9h11a2.5 2.5 0 1 0-2.5-2.5" />
    <path d="M4 13h14a2.5 2.5 0 1 1-2.5 2.5" />
    <path d="M4 17h8a2 2 0 1 0-2-2" />
  </svg>
);

/** A forest mushroom */
const Mushroom = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 12c0-3.9 3.1-7 7-7s7 3.1 7 7c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1z" />
    <path d="M10 13v5c0 1 .9 1.6 2 1.6s2-.6 2-1.6v-5" />
    <circle cx="9" cy="9.4" r=".8" />
    <circle cx="13" cy="8.4" r=".8" />
    <circle cx="15.4" cy="10.6" r=".7" />
  </svg>
);

export const GHIBLI_RELICS = [
  ForestSpirit,
  SootSprite,
  Acorn,
  Leaf,
  Umbrella,
  FlameSpirit,
  TreeSpirit,
  Feather,
  PaperPlane,
  Goldfish,
  WalkingCastle,
  Dragon,
  Teapot,
  Lantern,
  WindSwirl,
  Mushroom,
  glyphRelic('森'), // forest
  glyphRelic('風'), // wind
  glyphRelic('火'), // fire
] as const;
