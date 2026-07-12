/**
 * Wizarding-world relics — original line-art nods to the Harry Potter
 * universe, drawn in the same stroke language as everything else.
 * Easter eggs among the Norse artifacts, per the owner's request.
 */
import { base, glyphRelic, type RelicProps } from './shared';

/** The scar */
const LightningBolt = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M13 3 6 13h5l-2 8 9-11h-5l2-7h-2z" />
  </svg>
);

/** Round glasses */
const RoundGlasses = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="7" cy="13" r="3.5" />
    <circle cx="17" cy="13" r="3.5" />
    <path d="M10.5 13h3M3.5 12.5 2 11M20.5 12.5 22 11" />
  </svg>
);

/** Wand mid-spell */
const Wand = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="m4 20 12-12" />
    <path d="M18 4v.01M21 7v.01M20 3v.01M17 7.5l1-1" />
  </svg>
);

/** Flying broomstick */
const Broom = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="m3 17 12-8" />
    <path d="M15 9c2-1.5 4-2 6-2-.5 2-1.5 4-3.5 5.5L15 9z" />
    <path d="M17 13.5 19 16m-3.5-1.5 1 2.5" />
  </svg>
);

/** Winged golden ball */
const Snitch = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M9 11C6.5 9.5 4.5 9 2 9.5c1 2 2.5 3.5 5 4M15 11c2.5-1.5 4.5-2 7-1.5-1 2-2.5 3.5-5 4" />
  </svg>
);

/** Bubbling cauldron */
const Cauldron = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 10h14c0 6-3 9-7 9s-7-3-7-9z" />
    <path d="M3.5 10h17" />
    <path d="M9 6.5v.01M13 4.5v.01M15.5 7v.01" />
  </svg>
);

/** Potion flask */
const Potion = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M10 3h4M11 3v5l5 9c1 2-.5 4-2.5 4h-3c-2 0-3.5-2-2.5-4l5-9" />
    <path d="M8.5 15h7" />
  </svg>
);

/** Pointed wizard hat */
const WizardHat = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M14 4c2 4 3.5 8 4.5 13H4C7 13 10 8 14 4z" />
    <path d="M3 17c3 1.5 15 1.5 18 0" />
    <path d="M12 10c1 .5 2 .5 3-.5" />
  </svg>
);

/** Messenger owl */
const Owl = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M7 5c1.5-1.5 3-2 5-2s3.5.5 5 2c1 5 .5 11-5 16-5.5-5-6-11-5-16z" />
    <circle cx="9.5" cy="9" r="1.5" />
    <circle cx="14.5" cy="9" r="1.5" />
    <path d="m12 11-1 2h2l-1-2z" />
  </svg>
);

/** Winged key */
const FlyingKey = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="2.5" />
    <path d="M12 10.5V19m0-3h3m-3-2h2" />
    <path d="M9.5 7C7 5.5 5 5.5 3 6.5c1 1.5 2.5 2.5 5 2.5M14.5 7c2.5-1.5 4.5-1.5 6.5-.5-1 1.5-2.5 2.5-5 2.5" />
  </svg>
);

/** The three brothers' sign */
const Hallows = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3 3 20h18L12 3z" />
    <circle cx="12" cy="14" r="4" />
    <path d="M12 3v17" />
  </svg>
);

/** Time-turner */
const TimeTurner = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M9 8h6l-6 8h6" />
    <path d="M12 2v2M12 20v2" />
  </svg>
);

/** Feather quill */
const Quill = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 19C7 12 12 6 19 4c-1 7-6 12-12 13" />
    <path d="M5 19c4-5 8-9 11-11" />
    <path d="M5 19H3.5" />
  </svg>
);

/** The letter that finds you anywhere */
const Letter = (p: RelicProps) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="18" height="13" rx="1" />
    <path d="m3 7 9 7 9-7" />
    <circle cx="12" cy="14" r="1.2" />
  </svg>
);

/** Steam engine to school */
const Express = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M4 15V8h8l3 3h4v4" />
    <path d="M3 15h18v2H3z" />
    <circle cx="7" cy="19" r="1.4" />
    <circle cx="15" cy="19" r="1.4" />
    <path d="M7 8V5.5M7 4v.01" />
  </svg>
);

/** Antlered patronus */
const Stag = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M9 21c0-4 1-7 3-9 2 2 3 5 3 9" />
    <path d="M12 12 9 6M12 12l3-6" />
    <path d="M9 6C8 5 7 4.5 5.5 4.5M9 6c-.5-1.5-.5-2.5 0-3.5M15 6c1-1 2-1.5 3.5-1.5M15 6c.5-1.5.5-2.5 0-3.5" />
  </svg>
);

/** The serpent of the house of cunning */
const Serpent = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M17 4c-4 0-9 1.5-9 4.5S16 12 16 15s-5 4.5-9 4.5" />
    <path d="M17 4c1.5 0 2.5 1 2.5 2S18.5 8 17 8s-2.5-1-2.5-2" />
    <path d="M18 5.5v.01" />
  </svg>
);

/** Crystal ball on its stand */
const CrystalBall = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="10" r="6.5" />
    <path d="M7 19c1-1.5 3-2.5 5-2.5s4 1 5 2.5H7z" />
    <path d="M9 7.5c.5-1 1.5-2 3-2" />
  </svg>
);

/** Floating candle */
const Candle = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M9 9h6v11H9z" />
    <path d="M12 9V7" />
    <path d="M12 3c1 1.2 1.5 2 1.5 2.8A1.5 1.5 0 0 1 12 7a1.5 1.5 0 0 1-1.5-1.2c0-.8.5-1.6 1.5-2.8z" />
  </svg>
);

/** Sword pulled from the hat */
const Sword = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M19 5 9 15" />
    <path d="m7 13 4 4M6 18l-2 2m2-6 4 4" />
    <circle cx="19.5" cy="4.5" r="0.9" />
  </svg>
);

export const POTTER_RELICS = [
  LightningBolt,
  RoundGlasses,
  Wand,
  Broom,
  Snitch,
  Cauldron,
  Potion,
  WizardHat,
  Owl,
  FlyingKey,
  Hallows,
  TimeTurner,
  Quill,
  Letter,
  Express,
  Stag,
  Serpent,
  CrystalBall,
  Candle,
  Sword,
  glyphRelic('9¾', 11), // the platform
] as const;
