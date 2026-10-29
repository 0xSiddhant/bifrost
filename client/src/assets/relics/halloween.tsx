/**
 * Halloween relics — original line art for spooky season: carved pumpkins,
 * ghosts and bats, the witch's and the graveyard's things, and the sweets that
 * come with them. Same faint stroke language as the other collections.
 */
import { base, glyphRelic, type RelicProps } from './shared';

/** Jack-o'-lantern */
const JackOLantern = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 6.5c.1-1.5.8-2.6 2-3.1" />
    <path d="M12 6.6c-1.2-.8-3-.9-4.6-.2C4.6 7.6 3 10.1 3 13.2c0 3.6 2.6 6.3 5.7 6.3 1.2 0 2.2-.4 3.3-.4s2.1.4 3.3.4c3.1 0 5.7-2.7 5.7-6.3 0-3.1-1.6-5.6-4.4-6.8-1.6-.7-3.4-.6-4.6.2z" />
    <path d="M7.6 11.6 9 9.6l1.4 2zM13.6 11.6 15 9.6l1.4 2zM11.3 13.4h1.4L12 12.3z" />
    <path d="M7.4 14.5c.9 2 2.6 3.1 4.6 3.1s3.7-1.1 4.6-3.1l-1.2.7-1.1-.6-1.1.7-1.2-.6-1.2.6-1.1-.7-1.1.6-1.2-.7z" />
  </svg>
);

/** Bat */
const Bat = (p: RelicProps) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="12.3" rx="1.4" ry="2.6" />
    <path d="M10.9 10.2l-.3-1.6 1 .8h.8l1-.8-.3 1.6" />
    <path d="M13.3 11.2c1.8-1.6 4.8-2.6 8.2-2.4-.9.7-1.4 1.6-1.4 2.6-1.1-.5-2.4-.3-3.2.6-.8-.4-1.9-.2-2.5.6-.3-.6-.7-1.1-1.1-1.4" />
    <path d="M10.7 11.2c-1.8-1.6-4.8-2.6-8.2-2.4.9.7 1.4 1.6 1.4 2.6 1.1-.5 2.4-.3 3.2.6.8-.4 1.9-.2 2.5.6.3-.6.7-1.1 1.1-1.4" />
  </svg>
);

/** Ghost */
const Ghost = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6 19.5V11a6 6 0 0 1 12 0v8.5q-1-1.2-2 0t-2 0-2 0-2 0-2 0-2 0z" />
    <ellipse cx="10" cy="11" rx=".8" ry="1.1" />
    <ellipse cx="14" cy="11" rx=".8" ry="1.1" />
    <ellipse cx="12" cy="14.3" rx=".9" ry="1.2" />
    <path d="M6 13.2c-1.2.3-2.1-.1-2.6-1M18 13.2c1.2.3 2.1-.1 2.6-1" />
  </svg>
);

/** Witch's hat */
const WitchHat = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M7.4 16.4 10.4 7.6c.7-2 2-3.5 3.9-4.1 1.3-.4 2.7-.1 3.7.8-1.5-.3-2.7.2-3.3 1.4L16.6 16.4" />
    <path d="M8.4 13.4c2.5.7 5.2.7 7.7 0" />
    <path d="M11 13.9h2.4v2.3H11z" />
    <path d="M7.4 16.4c-2.9.3-4.9 1-4.9 1.8 0 1.2 4.3 2.2 9.5 2.2s9.5-1 9.5-2.2c0-.8-2-1.5-4.9-1.8" />
  </svg>
);

/** Crescent moon */
const HarvestMoon = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    <path d="M17.5 3.6v2.8M16.1 5h2.8M20.4 8.6v.01" />
  </svg>
);

/** Hanging spider */
const Spider = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 2v6.5" />
    <circle cx="12" cy="9.8" r="1.3" />
    <ellipse cx="12" cy="13.7" rx="2.4" ry="2.7" />
    <path d="M10.9 10.8 8.4 9.2 7 10.6M9.7 12.5H7l-1.5 1.8M9.8 14.4l-2.4 1.4-.6 2.4M10.6 16l-1.3 2.4.4 1.8" />
    <path d="M13.1 10.8l2.5-1.6 1.4 1.4M14.3 12.5H17l1.5 1.8M14.2 14.4l2.4 1.4.6 2.4M13.4 16l1.3 2.4-.4 1.8" />
  </svg>
);

/** Cobweb */
const Cobweb = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3 5.3 18.7" />
    <path d="M12 9Q12.91 9.8 14.12 9.88Q14.2 11.09 15 12Q14.2 12.91 14.12 14.12Q12.91 14.2 12 15Q11.09 14.2 9.88 14.12Q9.8 12.91 9 12Q9.8 11.09 9.88 9.88Q11.09 9.8 12 9M12 6.2Q13.76 7.74 16.1 7.9Q16.26 10.24 17.8 12Q16.26 13.76 16.1 16.1Q13.76 16.26 12 17.8Q10.24 16.26 7.9 16.1Q7.74 13.76 6.2 12Q7.74 10.24 7.9 7.9Q10.24 7.74 12 6.2M12 3.4Q14.61 5.69 18.08 5.92Q18.31 9.39 20.6 12Q18.31 14.61 18.08 18.08Q14.61 18.31 12 20.6Q9.39 18.31 5.92 18.08Q5.69 14.61 3.4 12Q5.69 9.39 5.92 5.92Q9.39 5.69 12 3.4" />
  </svg>
);

/** Skull */
const Skull = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6.5 11a5.5 5.5 0 0 1 11 0c0 1.9-.8 3.2-2 4v2.2c0 .5-.4.8-.8.8H9.3c-.4 0-.8-.3-.8-.8V15c-1.2-.8-2-2.1-2-4z" />
    <circle cx="9.7" cy="11.2" r="1.4" />
    <circle cx="14.3" cy="11.2" r="1.4" />
    <path d="M12 13.3l-.7 1.2h1.4zM10.6 16v2M12 16v2M13.4 16v2" />
  </svg>
);

/** Black cat */
const BlackCat = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M8.2 20c-.9-2.6-.6-5.1.9-7.1-1.2-.9-1.9-2.2-1.9-3.7 0-.8.2-1.6.6-2.2L7.4 3.8l2.7 1.9c.6-.2 1.2-.3 1.9-.3s1.3.1 1.9.3l2.7-1.9-.4 3.2c.4.6.6 1.4.6 2.2 0 1.5-.7 2.8-1.9 3.7 1.5 2 1.8 4.5.9 7.1H8.2z" />
    <path d="M15.8 20c2.2.2 4-1 4-3.2 0-1.6-1.5-2.4-2.6-1.6" />
    <ellipse cx="10.4" cy="9.3" rx=".9" ry=".55" />
    <ellipse cx="13.6" cy="9.3" rx=".9" ry=".55" />
    <path d="M11.5 10.9h1l-.5.6z" />
  </svg>
);

/** Candy corn */
const CandyCorn = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5c-.9 0-1.7 1-2.5 2.8L6.3 15c-.9 2.6.6 4.6 3.4 4.9 1.5.2 3.1.2 4.6 0 2.8-.3 4.3-2.3 3.4-4.9l-3.2-8.7C13.7 4.5 12.9 3.5 12 3.5z" />
    <path d="M8.4 9.6c2.3.6 4.9.6 7.2 0M6.9 13.9c3.3.8 6.9.8 10.2 0" />
  </svg>
);

/** Tombstone */
const Tombstone = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6.5 20V9.5a5.5 5.5 0 0 1 11 0V20" />
    <path d="M3.5 20h17" />
    <path d="M12 8v6M10 10h4" />
    <path d="M15.4 5.6l-.9 1.5.8 1.2-.6 1.3" />
    <path d="M4.6 20c0-.8-.3-1.5-.8-2M5.2 20c.2-.9.6-1.5 1-1.8M18.8 20c-.2-.9-.6-1.5-1-1.8M19.4 20c0-.8.3-1.5.8-2" />
  </svg>
);

/** Haunted house */
const HauntedHouse = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3 20.5h18" />
    <path d="M5 20.5V12l4.5-4 4.5 4v8.5" />
    <path d="M14 20.5V10h4.5v10.5M13.3 10l2.95-6.5L19.2 10" />
    <path d="M8 20.5v-3.2a1.5 1.5 0 0 1 3 0v3.2" />
    <path d="M8.5 12.3h2v2h-2z" />
    <path d="M15.4 13.6V12.4c0-.6.4-1 .85-1s.85.4.85 1v1.2z" />
  </svg>
);

/** Coffin */
const Coffin = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M9 2.5h6l3 5.5-2.2 13.5H8.2L6 8z" />
    <path d="M12 7v7M9.8 9.4h4.4" />
  </svg>
);

/** Wrapped candy */
const WrappedCandy = (p: RelicProps) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="12" rx="3.6" ry="3" />
    <path d="M8.5 11.2 4 8.5v7l4.5-2.7M15.5 11.2 20 8.5v7l-4.5-2.7" />
    <path d="M10.7 9.3l1.4 5.3M12.9 9.2l1.2 4.4" />
  </svg>
);

/** Swirl lollipop */
const Lollipop = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="9" r="5.5" />
    <path d="M12 9a1 1 0 0 1 2 0 2 2 0 0 1-4 0 3 3 0 0 1 6 0 4 4 0 0 1-8 0" />
    <path d="M12 14.5v7" />
  </svg>
);

/** Gnarled tree */
const GnarledTree = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M10.5 21c.8-2.5.9-5.2.2-8M13.5 21c-.6-2-.6-4.2.2-6.4" />
    <path d="M10.7 13C9.3 11.8 8 10 7.6 7.8L5.4 6.6M7.6 7.8l-.4-3" />
    <path d="M13.7 14.6c1.3-1.5 3.1-2.4 5.3-2.6l1.5-1.8M16.4 12.5l.4-2.6" />
    <path d="M12.2 12.6c0-2.2.6-4.4 2-6.2l2.2-1.4M14.2 6.4l-.5-2.4" />
    <path d="M5 21h14" />
  </svg>
);

/** Frankenstein's monster */
const Frankenstein = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M7 5.5h10V16c0 2.2-2.2 4-5 4s-5-1.8-5-4V5.5z" />
    <path d="M7 8.5l1.7-1.3 1.6 1.3 1.7-1.3 1.7 1.3 1.6-1.3L17 8.5" />
    <path d="M7 14H4.8M4.8 13v2M17 14h2.2M19.2 13v2" />
    <path d="M9 11.2h1.8M13.2 11.2H15M10 16.6h4M10.9 16v1.2M13.1 16v1.2" />
  </svg>
);

/** Mummy */
const Mummy = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6.5 11a5.5 5.5 0 0 1 11 0v4.5a5.5 5 0 0 1-11 0z" />
    <path d="M6.7 9.6 16.6 7.9M6.5 13.2l11-1.8M6.8 17.2l10.4-1.7M8.6 19.4l6.8-1.2" />
    <circle cx="10" cy="10.8" r=".9" />
    <circle cx="14.2" cy="10.3" r=".9" />
    <path d="M17.5 13.4c1.4.2 2.4 1 2.8 2.3" />
  </svg>
);

/** Reaper's scythe */
const Scythe = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6 21.5c3.2-6.4 6.6-12.7 10.5-19" />
    <path d="M16 3.4C11.5 1.6 6.4 3 3 8.8c3.6-3.2 7.8-3.8 11.6-2.4" />
    <path d="M8.9 15.6l2.6 1.2" />
  </svg>
);

/** Eyeball */
const Eyeball = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12.6" cy="11.4" r="3" />
    <circle cx="12.6" cy="11.4" r="1.1" />
    <path d="M4.6 13.2l1.6-.1.7.8 1.3-.3M9.4 19l.4-1.6-.6-.9.7-1.1M18.4 16l-1.5-.4-.5-1.1-1.1-.3M6.2 7.2l1.3.9.2 1.2 1 .5" />
  </svg>
);

/** Vampire */
const Vampire = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M7.5 9.5c0-2.9 2-5 4.5-5s4.5 2.1 4.5 5v3.2c0 2.7-2 5.3-4.5 5.3s-4.5-2.6-4.5-5.3z" />
    <path d="M7.6 9.2c1.4-.2 2.9-.9 4.4-2.4 1.5 1.5 3 2.2 4.4 2.4" />
    <path d="M9.2 10.8l1.6.5M14.8 10.8l-1.6.5M9.5 12.2h1.2M13.3 12.2h1.2" />
    <path d="M10.2 14.8h3.6M10.8 14.8l.35 1 .35-1M12.5 14.8l.35 1 .35-1" />
    <path d="M7.6 12.6 4 10.4l1.5 8 4.4 2.1M16.4 12.6l3.6-2.2-1.5 8-4.4 2.1" />
  </svg>
);

/** Scarecrow */
const Scarecrow = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M5.8 7.5h12.4M8.6 7.5l.8-3.5h5.2l.8 3.5" />
    <circle cx="12" cy="10.5" r="3" />
    <path d="M10.2 9.5l.8.8M11 9.5l-.8.8M13 9.5l.8.8M13.8 9.5l-.8.8M10.4 11.7c1 .8 2.2.8 3.2 0" />
    <path d="M9 13.6h6l1 5.4H8z" />
    <path d="M3.5 15h5.1M15.4 15h5.1M3.5 15l-1.3-1M3.5 15l-1.3 1M20.5 15l1.3-1M20.5 15l1.3 1M12 19v2.5" />
  </svg>
);

/** Crow on a post */
const Crow = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 7c-1.3 0-2.3.8-2.7 1.9L6.8 10l2.6.3c.3 2.4 1.9 4.3 4.3 4.7h1.6c1.2-.3 2.2-.9 3-1.8l2.5.6-1.8-2c.1-1.6-.8-2.9-2.3-3.4l-2.2-.7C14.2 7.6 13.3 7 12 7z" />
    <circle cx="11.6" cy="8.9" r=".45" />
    <path d="M12.5 11.2c1.5.9 3.2 1.1 4.8.6M13.3 15v1.2M14.8 15v1.2" />
    <path d="M12 16.2h4.2v5.3H12z" />
  </svg>
);

/** Trick-or-treat pail */
const TreatPail = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6.5 10.5C6.5 3.6 17.5 3.6 17.5 10.5" />
    <path d="M5 10.5h14M5.6 10.5l.9 8.2c.1.8.8 1.3 1.6 1.3h7.8c.8 0 1.5-.5 1.6-1.3l.9-8.2" />
    <path d="M8.7 14.4l1-1.4 1 1.4zM13.3 14.4l1-1.4 1 1.4zM9.2 16.6c1.7 1 3.9 1 5.6 0" />
    <path d="M9.4 10.5c-.2-1.2.4-2 1.4-2.1M14.4 10.5l.8-1.6" />
    <circle cx="15.7" cy="8" r="1" />
  </svg>
);

/** Hand from the grave */
const RisingHand = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M2.5 20.5h19M4 20.5c2.3-1.6 5-2.4 8-2.4s5.7.8 8 2.4" />
    <path d="M10.8 18.1v-4.5M13.2 18.1v-4.5" />
    <path d="M9.6 11.2h4.8l-.4 2.4H10z" />
    <path d="M10 11.2V6.5M11.4 11V5.2M12.8 11V5.6M14.2 11.3V7M9.6 12.4 7.8 10.2" />
    <path d="M9.6 8.6h.8M11 7.8h.8M12.4 8h.8M13.8 9h.8" />
  </svg>
);

/** Skull & crossbones */
const SkullCrossbones = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M8 9a4 4 0 0 1 8 0c0 1.4-.6 2.4-1.5 3v1.4c0 .4-.3.6-.6.6h-3.8c-.3 0-.6-.2-.6-.6V12c-.9-.6-1.5-1.6-1.5-3z" />
    <circle cx="10.5" cy="9.2" r=".9" />
    <circle cx="13.5" cy="9.2" r=".9" />
    <path d="M5.4 20.5 18.6 14.3M5.4 14.3l13.2 6.2" />
    <circle cx="4.6" cy="21" r=".9" />
    <circle cx="19.4" cy="13.8" r=".9" />
    <circle cx="4.6" cy="13.8" r=".9" />
    <circle cx="19.4" cy="21" r=".9" />
  </svg>
);

/** Pumpkin patch */
const PumpkinPatch = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 8.2c-1.1-.6-2.6-.7-4-.2C5.6 8.9 4.5 11 4.5 13.6c0 3.2 2.3 5.6 5 5.6 1 0 1.7-.3 2.5-.3s1.5.3 2.5.3c2.7 0 5-2.4 5-5.6 0-2.6-1.1-4.7-3.5-5.6-1.4-.5-2.9-.4-4 .2z" />
    <path d="M9.6 8.2c-1.3 1.6-1.8 3.4-1.8 5.4s.6 4 1.7 5.4M14.4 8.2c1.3 1.6 1.8 3.4 1.8 5.4s-.6 4-1.7 5.4M12 8.6v10.3" />
    <path d="M12 8.2c0-1.6.3-2.8 1.2-3.7" />
    <path d="M13.2 4.5c1.2-.9 2.8-.9 3.6.2.6.9.1 2-1 1.9-.8-.1-1-1-.4-1.4" />
    <path d="M11.8 5.4c-1.6-1.6-3.8-1.6-5-.6 1.2 1.4 3.2 1.8 5 .6z" />
  </svg>
);

/** Voodoo doll */
const VoodooDoll = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="7" r="3.2" />
    <path d="M10.3 6.1l1 1M11.3 6.1l-1 1M12.7 6.1l1 1M13.7 6.1l-1 1M10.6 8.6h2.8M11.2 8.2v.8M12.8 8.2v.8" />
    <path d="M10 10.1c-1 .2-1.7.6-2.3 1.2L5 13.2l.9 1.2 2.6-1.3.4 3.2-1.4 4.2 1.4.6 2.2-3.6h1.8l2.2 3.6 1.4-.6-1.4-4.2.4-3.2 2.6 1.3.9-1.2-2.7-1.9c-.6-.6-1.3-1-2.3-1.2" />
    <path d="M12 14.2s-1.3-.7-1.3-1.5c0-.5.6-.8 1.3-.3.7-.5 1.3-.2 1.3.3 0 .8-1.3 1.5-1.3 1.5z" />
    <path d="M14.6 12.2l3-3" />
    <circle cx="17.9" cy="8.9" r=".55" />
  </svg>
);

/** Cemetery gate */
const CemeteryGate = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3.5 21V8.5H6V21M18 21V8.5h2.5V21M3 8.5h3.5M17.5 8.5H21" />
    <circle cx="4.75" cy="7.3" r=".9" />
    <circle cx="19.25" cy="7.3" r=".9" />
    <path d="M6 9.5c2-1.6 4-2.4 6-2.4s4 .8 6 2.4" />
    <path d="M8.5 21V8.3M10.3 21V7.5M12 21V7.1M13.7 21V7.5M15.5 21V8.3M6 15.5h12" />
    <path d="M11.4 6.4l.6-1 .6 1" />
  </svg>
);

/** Caramel apple */
const CaramelApple = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M12 8.5c-1-.7-2.4-1-3.7-.6C5.9 8.6 5 10.8 5 13c0 3.6 2.7 6.5 5 6.5.7 0 1.3-.3 2-.3s1.3.3 2 .3c2.3 0 5-2.9 5-6.5 0-2.2-.9-4.4-3.3-5.1-1.3-.4-2.7-.1-3.7.6z" />
    <path d="M5.3 11.5c1 .5 1.6 1.6 1.7 2.7.4-.9 1.1-1.4 2-1.2.3 1 .9 1.5 1.6 1.4.4-.8 1-1.1 1.8-.9.3 1.1 1 1.6 1.8 1.3.2-.9.8-1.4 1.6-1.4.4-1.1 1.1-1.8 2-2.1" />
    <path d="M12 8.5V2.5" />
  </svg>
);

/** Full moon & bat */
const MoonBat = (p: RelicProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 10.4l-.5-.9-.2 1.1c-1.3-.9-3-1.2-4.5-.8.5.4.8.9.9 1.5.6-.3 1.3-.2 1.8.3.4-.3 1-.3 1.4 0 .3.5.7 1 1.1 1.4.4-.4.8-.9 1.1-1.4.4-.3 1-.3 1.4 0 .5-.5 1.2-.6 1.8-.3.1-.6.4-1.1.9-1.5-1.5-.4-3.2-.1-4.5.8l-.2-1.1z" />
    <path d="M20.6 2.8v2.4M19.4 4h2.4" />
  </svg>
);

/** Howling werewolf */
const Werewolf = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M6.5 21c.1-2.4.5-4.4 1.1-6 .5-1.6 1.1-3 1.6-4.2-.4-1.6-.4-3.1-.1-4.6l1.1-2 2.2 3.4c.6-.1 1.2-.1 1.8.3l5.4-4.1-.2 1.2-3.2 3.6 2.8-1-.6 1.2c-.8.9-1.8 1.6-2.8 2l-1 .8.6.8-1 .8.4.8c-.3 1.2-.4 2.6-.2 4 .2 1 .6 2 .8 3" />
    <path d="M13.6 9.4l1.2-.5M10.6 6.2l.9 1.6" />
    <path d="M4 3.4a2.4 2.4 0 1 0 2.9 3.4A1.9 1.9 0 0 1 4 3.4z" />
  </svg>
);

/** Grimoire */
const Grimoire = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M4.5 19V5.5A2.5 2.5 0 0 1 7 3h12.5v15.5H7a2.5 2.5 0 0 0 0 5h12.5" />
    <path d="M9 10.5c1.6-2 4.4-2 6 0-1.6 2-4.4 2-6 0z" />
    <circle cx="12" cy="10.5" r=".9" />
    <path d="M12 6.2v1M12 13.8v1M8 7.4l.6.7M16 7.4l-.6.7" />
    <path d="M19.5 9h-1.5v3h1.5" />
  </svg>
);

/** Eyes in the dark */
const EyesInTheDark = (p: RelicProps) => (
  <svg {...base(p)}>
    <path d="M3.6 7.2Q5.87 10.52 9.4 8.6Q7.13 5.28 3.6 7.2zM14.6 8.6Q18.13 10.52 20.4 7.2Q16.87 5.28 14.6 8.6zM3 15.4Q4.63 17.51 7 16.3Q5.37 14.19 3 15.4zM9 16.3Q11.37 17.51 13 15.4Q10.63 14.19 9 16.3zM12.4 19.2Q13.85 21.16 16 20Q14.55 18.04 12.4 19.2zM17.8 20Q19.95 21.16 21.4 19.2Q19.25 18.04 17.8 20z" />
    <path d="M6.5 6.8v2.2M17.5 6.8v2.2M5 15.15v1.4M11 15.15v1.4M14.2 18.9v1.4M19.6 18.9v1.4" />
  </svg>
);

export const HALLOWEEN_RELICS = [
  JackOLantern,
  Bat,
  Ghost,
  WitchHat,
  HarvestMoon,
  Spider,
  Cobweb,
  Skull,
  BlackCat,
  CandyCorn,
  Tombstone,
  HauntedHouse,
  Coffin,
  WrappedCandy,
  Lollipop,
  GnarledTree,
  Frankenstein,
  Mummy,
  Scythe,
  Eyeball,
  Vampire,
  Scarecrow,
  Crow,
  TreatPail,
  RisingHand,
  SkullCrossbones,
  PumpkinPatch,
  VoodooDoll,
  CemeteryGate,
  CaramelApple,
  MoonBat,
  Werewolf,
  Grimoire,
  EyesInTheDark,
  glyphRelic('BOO', 8.5), // the word itself
] as const;
