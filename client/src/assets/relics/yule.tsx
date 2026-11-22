/**
 * Yule relics — original line art for winter and Christmas: tree ornaments
 * and decorations, the things of Christmas, snow and ice, and a few nods to
 * an ice-palace winter tale (the palace, a reindeer with a carrot, a twig-armed
 * snowman, a crocus). Same faint stroke language as the other collections.
 */
import { base, glyphRelic, type RelicProps } from './shared';

// ── Ornaments and decorations ─────────────────────────────────────

/** Round bauble with a swirl band */
const Bauble = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="14" r="6.5" />
    <path d="M10.4 7.8V6.4h3.2v1.4" />
    <path d="M12 6.4c0-1.6 1.6-2.4 2.4-1.4" />
    <path d="M5.7 12.6c2.2 1.4 4.4-1.2 6.3 0s4.1 1.4 6.3 0M6.1 16.4c2 1 4-1 5.9 0s3.9 1 5.9 0" />
  </svg>
);

/** Teardrop finial ornament */
const Finial = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3.2v2" />
    <path d="M10.6 5.2h2.8v1.6h-2.8z" />
    <path d="M12 6.8c3.4 1.6 5 4.4 5 7.2 0 2.6-2 4.4-5 8-3-3.6-5-5.4-5-8 0-2.8 1.6-5.6 5-7.2z" />
    <path d="M7.4 12h9.2M7.8 15.4h8.4" />
  </svg>
);

/** Star for the top of the tree */
const StarTopper = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5l2.4 5.1 5.6.6-4.2 3.8 1.2 5.5L12 15.7l-5 2.8 1.2-5.5L4 9.2l5.6-.6z" />
    <path d="M12 15.8v5.4M3 3.6l1.4 1.4M21 3.6l-1.4 1.4" />
  </svg>
);

/** Decorated Christmas tree */
const ChristmasTree = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 4.6l-4 5h2.2l-3.6 4.8h2.4L5 19h14l-4-4.6h2.4L13.8 9.6H16z" />
    <path d="M11 19v2.2h2V19" />
    <path d="M12 2.2l.6 1.2 1.3.2-1 .9.3 1.3-1.2-.7-1.2.7.3-1.3-1-.9 1.3-.2z" />
    <circle cx="10.2" cy="12.4" r=".5" />
    <circle cx="13.6" cy="16" r=".5" />
    <circle cx="9" cy="16.8" r=".5" />
  </svg>
);

/** Wreath with a bow */
const Wreath = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="11.6" r="7" />
    <circle cx="12" cy="11.6" r="4" />
    <path d="M7.1 6.7l1.6 1.8M16.9 6.7l-1.6 1.8M5 11.6h3M16 11.6h3M12 4.6v3" />
    <path d="M12 17.2l-3 2.4.2-3.6zM12 17.2l3 2.4-.2-3.6z" />
    <path d="M12 17.2l-1.6 4M12 17.2l1.6 4" />
  </svg>
);

/** Holly sprig */
const Holly = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M11 12.5C9 9.2 6.2 8 3 8.4c.9.8.8 1.8.3 2.6 1.1-.1 1.9.5 1.8 1.6 1-.4 2-.1 2.3.9.9-.6 2.1-.6 3.6-1z" />
    <path d="M13 12.5c2-3.3 4.8-4.5 8-4.1-.9.8-.8 1.8-.3 2.6-1.1-.1-1.9.5-1.8 1.6-1-.4-2-.1-2.3.9-.9-.6-2.1-.6-3.6-1z" />
    <path d="M10.6 12.2 4.4 9.4M13.4 12.2l6.2-2.8" />
    <circle cx="12" cy="14.2" r="1.6" />
    <circle cx="9.6" cy="15.8" r="1.6" />
    <circle cx="14.4" cy="15.8" r="1.6" />
  </svg>
);

/** Mistletoe tied with a ribbon */
const Mistletoe = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 2.5v4.5" />
    <path d="M12 7l-2.6-1.8v3.6zM12 7l2.6-1.8v3.6z" />
    <path d="M12 7v11M12 12l-3.6 3.4M12 12l3.6 3.4" />
    <path d="M8.4 15.4c-2.4.4-4-.6-4.6-2.6 2.4-.4 4 .6 4.6 2.6zM15.6 15.4c2.4.4 4-.6 4.6-2.6-2.4-.4-4 .6-4.6 2.6zM12 12c-2-.6-3-2-2.8-3.8 2 .5 3 2 2.8 3.8zM12 12c2-.6 3-2 2.8-3.8-2 .5-3 2-2.8 3.8z" />
    <circle cx="11" cy="19" r="1" />
    <circle cx="13" cy="19" r="1" />
    <circle cx="12" cy="20.7" r="1" />
  </svg>
);

/** Poinsettia */
const Poinsettia = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 12Q9.9 7.5 12 4Q14.1 7.5 12 12M12 12Q15.7 8.6 19.6 9.5Q17 12.6 12 12M12 12Q16.4 14.4 16.7 18.5Q13 16.9 12 12M12 12Q11 16.9 7.3 18.5Q7.6 14.4 12 12M12 12Q7 12.6 4.4 9.5Q8.3 8.6 12 12" />
    <circle cx="12" cy="12" r="1.3" />
  </svg>
);

/** Jingle bells on a ribbon */
const JingleBells = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M4.2 18.5h7.6M5 18.5c.3-1.2.6-2 .6-3.6a2.4 2.4 0 0 1 4.8 0c0 1.6.3 2.4.6 3.6" />
    <path d="M12.2 18.5h7.6M13 18.5c.3-1.2.6-2 .6-3.6a2.4 2.4 0 0 1 4.8 0c0 1.6.3 2.4.6 3.6" />
    <circle cx="8" cy="19.7" r=".8" />
    <circle cx="16" cy="19.7" r=".8" />
    <path d="M8 12.5Q9 9.6 12 8.6M16 12.5Q15 9.6 12 8.6" />
    <path d="M12 8.6l-3-2.2v3.6zM12 8.6l3-2.2v3.6z" />
  </svg>
);

/** A Christmas light bulb on its wire */
const LightBulb = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3 2.4Q7.5 4.6 12 2.6T21 2.4" />
    <path d="M10.4 3.4h3.2v4.1h-3.2zM10.4 5.4h3.2" />
    <path d="M12 7.5c-2.8 1.6-4 4.6-4 7.3 0 2.9 1.8 5.2 4 5.7 2.2-.5 4-2.8 4-5.7 0-2.7-1.2-5.7-4-7.3z" />
    <path d="M10.2 11.6c-.6 1-.8 2.2-.7 3.4" />
  </svg>
);

/** Candy cane */
const CandyCane = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M8.4 21V8.5a3.6 3.6 0 0 1 7.2 0v1.3h-2.4V8.5a1.2 1.2 0 0 0-2.4 0V21z" />
    <path d="M8.4 18.6l2.4-1.6M8.4 14.8l2.4-1.6M8.4 11l2.4-1.6M9.4 6.2l1.8 1.4M12.6 4.9l-.2 2.4M15.4 7l-2.2 1.2" />
  </svg>
);

/** Wrapped gift */
const Gift = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M4.5 10h15v3h-15zM5.5 13h13v7.5h-13z" />
    <path d="M12 10v10.5" />
    <path d="M12 10c-1.4-2.6-4.4-3.8-5-2.2-.5 1.4 2.4 2.2 5 2.2zM12 10c1.4-2.6 4.4-3.8 5-2.2.5 1.4-2.4 2.2-5 2.2z" />
  </svg>
);

/** Stocking hung for gifts */
const Stocking = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M9 3.5h7v2.8H9z" />
    <path d="M9.4 6.3v7.2l-4 3.6c-1.4 1.3-.6 3.6 1.4 3.6.6 0 1.2-.2 1.7-.6l6-5.2c.9-.8 1.1-1.6 1.1-2.6V6.3" />
    <path d="M12.4 8.8v3.4M10.7 10.5h3.4M11.2 9.3l2.4 2.4M13.6 9.3l-2.4 2.4" />
  </svg>
);

/** Snow globe */
const SnowGlobe = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6.6 15.6a7 7 0 1 1 10.8 0" />
    <path d="M6 15.6h12l1.4 4.8H4.6z" />
    <path d="M12 7.4l-2.6 4h1.6l-2 3h6l-2-3h1.6z" />
    <path d="M7.4 14.6h9.2" />
    <circle cx="8.4" cy="9" r=".4" />
    <circle cx="15.6" cy="8.4" r=".4" />
    <circle cx="15" cy="12" r=".4" />
    <circle cx="11.8" cy="5.4" r=".4" />
  </svg>
);

// ── Christmas ──────────────────────────────────────────────────────

/** Santa hat */
const SantaHat = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5.6 17.4C6.4 11 9.6 6.2 14 5.6c3-.4 5.2 1.6 5.4 4.8" />
    <path d="M18.4 17.4c-.4-3.4-1.2-6-3-7.8" />
    <circle cx="19.4" cy="11.8" r="1.5" />
    <rect x="3.8" y="17.4" width="16.4" height="3.4" rx="1.7" />
  </svg>
);

/** Sleigh */
const Sleigh = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M4.5 16h12.5c2 0 3.4-1.4 3.6-3.6l.3-3.4" />
    <path d="M4.5 16C3.6 13 3.6 9.6 5 7.2c.9 1.4 1.8 2.6 3.4 3.2h11.5" />
    <path d="M3 19.5h15c2 0 3.2-1.2 3.4-3M7 16v3.5M15 16v3.5" />
    <path d="M8.6 13h9" />
  </svg>
);

/** A reindeer with a carrot */
const ReindeerCarrot = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M7.5 21c0-4 .8-7.4 3.2-9.6 1.6-1.4 3.6-1 5 .4l2.4 2.4c.7.7.4 1.9-.5 2.2-1.4.4-2.8.3-4-.4L12 15.2c-.6 2-.8 3.8-.6 5.8" />
    <circle cx="13" cy="13" r=".55" />
    <path d="M10.8 11.8 8.4 10.6l2.6-.4" />
    <path d="M11 11c-.6-2.8-2-4.6-3.6-5.6M8.8 7.6 6.2 7.8M9.8 8.6 9.6 6M12.4 10.6c.4-2.8 1.8-4.8 3.6-5.6M14.6 6.8l2.4-.6M13.4 8.4l1.2-2.4" />
    <path d="M17.8 15.6l4.6 2.4-4.4-.4zM17.8 15.6l-1-1.4M17.6 15.8l-1.6-.4" />
  </svg>
);

/** Gingerbread man */
const Gingerbread = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5a2.6 2.6 0 0 1 2.6 2.6c0 .8-.4 1.6-1 2h3.6a1.4 1.4 0 0 1 0 2.8h-2.6v2.6l2.4 4.4a1.4 1.4 0 0 1-2.4 1.4L12 16.2l-2.6 3.1a1.4 1.4 0 0 1-2.4-1.4l2.4-4.4V10.9H6.8a1.4 1.4 0 0 1 0-2.8h3.6c-.6-.4-1-1.2-1-2A2.6 2.6 0 0 1 12 3.5z" />
    <path d="M11 7.1q1 .7 2 0M6.6 9.5h.8M16.6 9.5h.8" />
    <circle cx="11" cy="5.8" r=".35" />
    <circle cx="13" cy="5.8" r=".35" />
    <circle cx="12" cy="10.6" r=".45" />
    <circle cx="12" cy="12.6" r=".45" />
  </svg>
);

/** Nutcracker soldier */
const Nutcracker = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3V1.6M9 3h6v4.6H9zM9 7.6h6v4.4H9z" />
    <path d="M9.6 10.4h4.8M10.4 11.2h3.2" />
    <circle cx="10.6" cy="9" r=".35" />
    <circle cx="13.4" cy="9" r=".35" />
    <path d="M8.2 12h7.6v6H8.2zM8.2 15.6h7.6M12 12v3.6" />
    <path d="M9.6 18v3.4M14.4 18v3.4M8.6 21.4h2.2M13.4 21.4h2.2M8.2 12.6l-1.4 4M15.8 12.6l1.4 4" />
  </svg>
);

/** Christmas angel */
const Angel = (p: RelicProps) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="3.6" rx="2.4" ry=".9" />
    <circle cx="12" cy="7.2" r="2" />
    <path d="M10.4 9.2 7.6 20.5h8.8L13.6 9.2" />
    <path d="M10.6 11c-2.6-2.4-5.6-2.6-7-1.2 1.4 1 1.6 2.6 1.2 4.2 1.8-.4 3.6-.6 5 .4M13.4 11c2.6-2.4 5.6-2.6 7-1.2-1.4 1-1.6 2.6-1.2 4.2-1.8-.4-3.6-.6-5 .4" />
    <path d="M10.6 13.2 12 14.4l1.4-1.2" />
  </svg>
);

/** Cocoa with marshmallows */
const Cocoa = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5.5 10h10v7.5a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z" />
    <path d="M15.5 11.5h1.6a2.4 2.4 0 0 1 0 4.8h-1.8" />
    <path d="M6.6 10V8.4h2.6V10M9.6 10V8.6h2.6V10M12.4 10V8.2H15V10" />
    <path d="M8 6.4c-.8-.9-.8-1.9 0-2.8s.8-1.9 0-2.6M11.6 6.4c-.8-.9-.8-1.9 0-2.8s.8-1.9 0-2.6" />
  </svg>
);

/** Yule log cake */
const YuleLog = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5.5 9.5h12.5M5.5 17h12.5M5.5 9.5a2.2 3.75 0 0 0 0 7.5" />
    <ellipse cx="18" cy="13.25" rx="2.2" ry="3.75" />
    <path d="M18 13.2c.5 0 .8.4.6.8-.3.6-1.3.6-1.6-.1-.4-.9.3-1.9 1.3-2 1.3-.1 2 1.2 1.6 2.4" />
    <path d="M8 11.6h4M10 14.8h5M6.8 14.2h1.2" />
    <path d="M10.6 9.5c-.4-1.4-1.6-2.2-3-2 .4.6.2 1.2 0 1.6.6 0 1 .4.9 1M12.6 9.5c.4-1.4 1.6-2.2 3-2-.4.6-.2 1.2 0 1.6-.6 0-1 .4-.9 1" />
    <circle cx="11.6" cy="8.6" r=".8" />
    <path d="M3 19.5h18" />
  </svg>
);

/** Knitted Christmas sweater */
const Sweater = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M9 4.5c.6 1.2 1.6 1.8 3 1.8s2.4-.6 3-1.8l4.6 2.2 1.4 6-2.6.8L17.4 12v8.5H6.6V12l-1 1.5L3 12.7l1.4-6z" />
    <path d="M6.6 14.6l1.35 1.2 1.35-1.2 1.35 1.2 1.35-1.2 1.35 1.2 1.35-1.2 1.35 1.2 1.35-1.2" />
    <path d="M6.6 18.6h10.8M12 8.4l-1.4 2.6h2.8z" />
  </svg>
);

/** A pair of mittens on a string */
const Mittens = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 21v-3.4L3.8 12.6a3 3 0 0 1 5.8-1.6l1.6 6.2V21zM4.6 15.4 2.8 14a1.2 1.2 0 0 1 1.4-1.8M5 18.6h6.2" />
    <path d="M19 21v-3.4l1.2-5a3 3 0 0 0-5.8-1.6l-1.6 6.2V21zM19.4 15.4l1.8-1.4a1.2 1.2 0 0 0-1.4-1.8M19 18.6h-6.2" />
    <path d="M8.2 10.4Q12 4 15.8 10.4" />
  </svg>
);

// ── Snow and ice ────────────────────────────────────────────────────

/** Snowflake: six-fold star */
const SnowflakeStar = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 12L12 3M12 6.4L10.01 4.73M12 6.4L13.99 4.73M12 9L10.61 8.2M12 9L13.39 8.2M12 12L19.79 7.5M16.85 9.2L17.3 6.64M16.85 9.2L19.29 10.09M14.6 10.5L14.6 8.9M14.6 10.5L15.98 11.3M12 12L19.79 16.5M16.85 14.8L19.29 13.91M16.85 14.8L17.3 17.36M14.6 13.5L15.98 12.7M14.6 13.5L14.6 15.1M12 12L12 21M12 17.6L13.99 19.27M12 17.6L10.01 19.27M12 15L13.39 15.8M12 15L10.61 15.8M12 12L4.21 16.5M7.15 14.8L6.7 17.36M7.15 14.8L4.71 13.91M9.4 13.5L9.4 15.1M9.4 13.5L8.02 12.7M12 12L4.21 7.5M7.15 9.2L4.71 10.09M7.15 9.2L6.7 6.64M9.4 10.5L8.02 11.3M9.4 10.5L9.4 8.9" />
  </svg>
);

/** Snowflake: branched dendrite */
const SnowflakeDendrite = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 10.4L12 3.2M12 9.2L10.79 8.5M12 9.2L13.21 8.5M12 7.4L10.09 6.3M12 7.4L13.91 6.3M12 5.6L10.44 4.7M12 5.6L13.56 4.7M12 4.2L11.13 3.7M12 4.2L12.87 3.7M13.39 11.2L19.62 7.6M14.42 10.6L14.42 9.2M14.42 10.6L15.64 11.3M15.98 9.7L15.98 7.5M15.98 9.7L17.89 10.8M17.54 8.8L17.54 7M17.54 8.8L19.1 9.7M18.75 8.1L18.75 7.1M18.75 8.1L19.62 8.6M13.39 12.8L19.62 16.4M14.42 13.4L15.64 12.7M14.42 13.4L14.42 14.8M15.98 14.3L17.89 13.2M15.98 14.3L15.98 16.5M17.54 15.2L19.1 14.3M17.54 15.2L17.54 17M18.75 15.9L19.62 15.4M18.75 15.9L18.75 16.9M12 13.6L12 20.8M12 14.8L13.21 15.5M12 14.8L10.79 15.5M12 16.6L13.91 17.7M12 16.6L10.09 17.7M12 18.4L13.56 19.3M12 18.4L10.44 19.3M12 19.8L12.87 20.3M12 19.8L11.13 20.3M10.61 12.8L4.38 16.4M9.58 13.4L9.58 14.8M9.58 13.4L8.36 12.7M8.02 14.3L8.02 16.5M8.02 14.3L6.11 13.2M6.46 15.2L6.46 17M6.46 15.2L4.9 14.3M5.25 15.9L5.25 16.9M5.25 15.9L4.38 15.4M10.61 11.2L4.38 7.6M9.58 10.6L8.36 11.3M9.58 10.6L9.58 9.2M8.02 9.7L6.11 10.8M8.02 9.7L8.02 7.5M6.46 8.8L4.9 9.7M6.46 8.8L6.46 7M5.25 8.1L4.38 8.6M5.25 8.1L5.25 7.1M12 10.4L13.39 11.2L13.39 12.8L12 13.6L10.61 12.8L10.61 11.2Z" />
  </svg>
);

/** Snowflake: hexagonal plate */
const SnowflakePlate = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3.4L19.45 7.7L19.45 16.3L12 20.6L4.55 16.3L4.55 7.7ZM12 7.4L15.98 9.7L15.98 14.3L12 16.6L8.02 14.3L8.02 9.7ZM12 10.4L13.39 11.2L13.39 12.8L12 13.6L10.61 12.8L10.61 11.2ZM12 7.4L12 3.4M15.72 5.55L14.92 6.94M15.98 9.7L19.45 7.7M19.45 12L17.85 12M15.98 14.3L19.45 16.3M15.72 18.45L14.92 17.06M12 16.6L12 20.6M8.28 18.45L9.08 17.06M8.02 14.3L4.55 16.3M4.55 12L6.15 12M8.02 9.7L4.55 7.7M8.28 5.55L9.08 6.94" />
  </svg>
);

/** Snowman with a top hat, scarf and twig arms */
const Snowman = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="17.7" r="3.8" />
    <circle cx="12" cy="11.6" r="2.8" />
    <circle cx="12" cy="7.2" r="2" />
    <path d="M10.2 5.2h3.6M10.8 5.2V2.6h2.4v2.6" />
    <path d="M12.2 7.4l2.4.6-2.4.4" />
    <circle cx="11.3" cy="6.6" r=".3" />
    <circle cx="12.7" cy="6.6" r=".3" />
    <path d="M10 9.2q2 1 4 0M13.2 9.6l.6 2.4" />
    <path d="M9.4 11.2 5.4 8.4M6.6 9.2 5.8 7.6M14.6 11.2l4-2.8M17.4 9.2l.8-1.6" />
    <circle cx="12" cy="16.4" r=".35" />
    <circle cx="12" cy="18.4" r=".35" />
  </svg>
);

/** Icicles under a snowy eave */
const Icicles = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h19" />
    <path d="M2.5 4.5c2-1.6 4.4-1.8 6.8-1.2 2.6.6 5 .5 7.4-.3 2-.6 3.6-.4 4.8 1.5" />
    <path d="M3.5 4.5 4.6 11l1.1-6.5M7 4.5l1 4.2 1-4.2M10.2 4.5l1.4 11 1.4-11M14.6 4.5l.9 6 .9-6M17.6 4.5l1.2 8.6 1.2-8.6" />
  </svg>
);

/** Ice palace of crystal spires */
const IcePalace = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 2.5l2.2 5.5v12.5H9.8V8z" />
    <path d="M6.5 7l1.6 4.2v9.3H4.9v-9.3zM17.5 7l1.6 4.2v9.3h-3.2v-9.3z" />
    <path d="M8.1 14.5h1.7M14.2 14.5h1.7M2.5 20.5h19" />
    <path d="M11 20.5v-2.4a1 1 0 0 1 2 0v2.4" />
    <path d="M12 2.5V8M9.8 8h4.4M6.5 7v4.2M17.5 7v4.2" />
  </svg>
);

/** Ice skate */
const IceSkate = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6.5 3.5h5.2v7l6 2.4c1.4.6 2.3 1.8 2.3 3.1v.5H6.5z" />
    <path d="M9 6h2.7M9 8h2.7M9.4 10h2.8" />
    <path d="M4.5 20h13.8c1.6 0 2.7-1 2.7-2.4M8 16.5V20M17 16.5V20" />
  </svg>
);

/** Wooden sled */
const Sled = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M5 14h14" />
    <path d="M7 14v3.5M12 14v3.5M17 14v3.5" />
    <path d="M3 17.5h16a2.5 2.5 0 0 0 0-5" />
    <path d="M19 12c1.5-2.4 2.6-3.4 2.4-5.6" />
  </svg>
);

/** Igloo */
const Igloo = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3 19.5a9 9 0 0 1 18 0z" />
    <path d="M4.3 15.4h15.4M6.4 11.6h11.2M12 6.5v5.1M9 11.6v3.8M15 11.6v3.8M6.6 15.4v4.1M17.4 15.4v4.1" />
    <path d="M9.5 19.5v-2a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

/** Pine cone */
const PineCone = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3V1.6" />
    <path d="M12 3c3.2 2.4 5 6.4 5 10.2 0 4-2.4 7.3-5 7.8-2.6-.5-5-3.8-5-7.8C7 9.4 8.8 5.4 12 3z" />
    <path d="M9.8 6q2.2 3 4.4 0M8.2 9.4q3.8 2.2 7.6 0M7.2 13.2q4.8 2.6 9.6 0M8 17q4 2.4 8 0" />
  </svg>
);

/** Snow-laden pine */
const SnowyPine = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 2.5 7 9h2.6L5.4 14.8h3L4 21h16l-4.4-6.2h3L14.4 9H17z" />
    <path d="M9.6 9l1.2-.8 1.2.8 1.2-.8 1.2.8M8.4 14.8l1.4-.9 1.4.9 1.4-.9 1.4.9 1.4-.9 1.4.9" />
    <path d="M11 21v1.6h2V21M2.5 22.6h19" />
  </svg>
);

/** Penguin */
const Penguin = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3c3 0 4.6 2.4 4.6 5.4v6c0 3.6-2 6.6-4.6 6.6s-4.6-3-4.6-6.6v-6C7.4 5.4 9 3 12 3z" />
    <path d="M12 8.4c1.8 0 2.8 1.6 2.8 3.6v3c0 2.4-1.2 4.4-2.8 4.4s-2.8-2-2.8-4.4v-3c0-2 1-3.6 2.8-3.6z" />
    <circle cx="10.6" cy="6.6" r=".4" />
    <circle cx="13.4" cy="6.6" r=".4" />
    <path d="M11.2 7.8h1.6L12 9zM7.4 11.2c-1.4 1.2-2.2 3-2.2 4.8M16.6 11.2c1.4 1.2 2.2 3 2.2 4.8M9.4 21h2M12.6 21h2" />
  </svg>
);

/** Northern lights over the mountains */
const AuroraPeaks = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M2.5 20.5l5-7 3 3.6 3.4-5.6 7.6 9z" />
    <path d="M6.2 15.3 7.5 13.5l1.4 1.7M12.4 13.3l1.5-2.8 1.8 2.4" />
    <path d="M3 9.5c3-3 6-3.4 9-1.6s6 1.8 9-1.4M3.6 6.4c2.6-2.4 5.2-2.6 8-1.2s5.6 1.2 8.4-1.4" />
    <path d="M6 8.4v1.6M9 7.6v1.4M15 9.6v1.4M18 8.2v1.6" />
  </svg>
);

/** Crocus, the first flower through the snow */
const Crocus = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 13c-2.6-.4-4.2-3-3.8-7 1.6.4 2.8 1.4 3.8 3 1-1.6 2.2-2.6 3.8-3 .4 4-1.2 6.6-3.8 7z" />
    <path d="M12 9.6c-1.2-1.8-1.4-4-.2-6 1.4 1.8 1.4 4 .2 6z" />
    <path d="M12 13v8M12 21c-.6-3-2.2-5.4-4.6-7M12 21c.6-3 2.2-5.4 4.6-7M7.5 21h9" />
  </svg>
);

export const YULE_RELICS = [
  Bauble,
  Finial,
  StarTopper,
  ChristmasTree,
  Wreath,
  Holly,
  Mistletoe,
  Poinsettia,
  JingleBells,
  LightBulb,
  CandyCane,
  Gift,
  Stocking,
  SnowGlobe,
  SantaHat,
  Sleigh,
  ReindeerCarrot,
  Gingerbread,
  Nutcracker,
  Angel,
  Cocoa,
  YuleLog,
  Sweater,
  Mittens,
  SnowflakeStar,
  SnowflakeDendrite,
  SnowflakePlate,
  Snowman,
  Icicles,
  IcePalace,
  IceSkate,
  Sled,
  Igloo,
  PineCone,
  SnowyPine,
  Penguin,
  AuroraPeaks,
  Crocus,
  glyphRelic('JÓL', 9), // Old Norse and Icelandic for Yule
  glyphRelic('NOËL', 7.2),
] as const;
