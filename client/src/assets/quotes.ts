/**
 * Quote bank for the Nótt screensaver. One is chosen at random each time the
 * overlay appears (and on rotation). Quotes are drawn from the worlds Bifrost's
 * lore already borrows from — Harry Potter, the MCU, Naruto, Studio Ghibli,
 * Norse myth, and Greek myth/philosophy. Append freely; keep lines short
 * enough to breathe on a dark full-screen canvas.
 */
export type QuoteWorld = 'harry-potter' | 'mcu' | 'naruto' | 'ghibli' | 'norse' | 'greek';

export interface Quote {
  text: string;
  author: string;
  world: QuoteWorld;
}

/** Display names for each world (subtle label under the attribution). */
export const WORLD_LABELS: Record<QuoteWorld, string> = {
  'harry-potter': 'Hogwarts',
  mcu: 'The MCU',
  naruto: 'Naruto',
  ghibli: 'Studio Ghibli',
  norse: 'Norse Myth',
  greek: 'Ancient Greece',
};

export const QUOTES: readonly Quote[] = [
  // ── Harry Potter ──────────────────────────────────────────────
  {
    text: 'It is our choices, Harry, that show what we truly are, far more than our abilities.',
    author: 'Albus Dumbledore',
    world: 'harry-potter',
  },
  {
    text: 'Happiness can be found, even in the darkest of times, if one only remembers to turn on the light.',
    author: 'Albus Dumbledore',
    world: 'harry-potter',
  },
  {
    text: 'It does not do to dwell on dreams and forget to live.',
    author: 'Albus Dumbledore',
    world: 'harry-potter',
  },
  {
    text: 'We are only as strong as we are united, as weak as we are divided.',
    author: 'Albus Dumbledore',
    world: 'harry-potter',
  },
  {
    text: 'Words are, in my not-so-humble opinion, our most inexhaustible source of magic.',
    author: 'Albus Dumbledore',
    world: 'harry-potter',
  },
  {
    text: 'It matters not what someone is born, but what they grow to be.',
    author: 'Albus Dumbledore',
    world: 'harry-potter',
  },
  {
    text: 'After all this time? Always.',
    author: 'Severus Snape',
    world: 'harry-potter',
  },
  {
    text: 'Fear of a name increases fear of the thing itself.',
    author: 'Albus Dumbledore',
    world: 'harry-potter',
  },
  { text: 'Mischief managed.', author: 'Harry Potter', world: 'harry-potter' },

  // ── The MCU ───────────────────────────────────────────────────
  { text: 'I can do this all day.', author: 'Steve Rogers', world: 'mcu' },
  { text: 'Part of the journey is the end.', author: 'Tony Stark', world: 'mcu' },
  {
    text: 'Dread it. Run from it. Destiny arrives all the same.',
    author: 'Thanos',
    world: 'mcu',
  },
  {
    text: 'We never lose our demons. We only learn to live above them.',
    author: 'The Ancient One',
    world: 'mcu',
  },
  { text: 'Whatever it takes.', author: 'The Avengers', world: 'mcu' },
  {
    text: 'The hardest choices require the strongest wills.',
    author: 'Thanos',
    world: 'mcu',
  },
  { text: 'Wakanda forever!', author: 'T’Challa', world: 'mcu' },
  { text: 'We are Groot.', author: 'Groot', world: 'mcu' },
  { text: 'I am Iron Man.', author: 'Tony Stark', world: 'mcu' },

  // ── Naruto ────────────────────────────────────────────────────
  {
    text: "Hard work is worthless for those that don't believe in themselves.",
    author: 'Naruto Uzumaki',
    world: 'naruto',
  },
  {
    text: 'The true measure of a shinobi is not how he lives but how he dies.',
    author: 'Jiraiya',
    world: 'naruto',
  },
  {
    text: 'Those who abandon their friends are worse than scum.',
    author: 'Kakashi Hatake',
    world: 'naruto',
  },
  {
    text: 'People’s lives do not end when they die. It ends when they lose faith.',
    author: 'Itachi Uchiha',
    world: 'naruto',
  },
  {
    text: 'Wake up to reality. Nothing ever goes as planned in this accursed world.',
    author: 'Madara Uchiha',
    world: 'naruto',
  },

  // ── Studio Ghibli ─────────────────────────────────────────────
  {
    text: 'Once you have met someone, you never really forget them.',
    author: 'Zeniba — Spirited Away',
    world: 'ghibli',
  },
  {
    text: 'You cannot alter your fate. However, you can rise to meet it.',
    author: 'Princess Mononoke',
    world: 'ghibli',
  },
  {
    text: 'The wind is rising! We must try to live.',
    author: 'The Wind Rises',
    world: 'ghibli',
  },
  {
    text: 'Nothing that happens is ever forgotten, even if you cannot remember it.',
    author: 'Zeniba — Spirited Away',
    world: 'ghibli',
  },
  {
    text: "A heart's a heavy burden.",
    author: 'Sophie — Howl’s Moving Castle',
    world: 'ghibli',
  },
  {
    text: 'Life is suffering. It is hard. But still, you find reasons to keep living.',
    author: 'Princess Mononoke',
    world: 'ghibli',
  },

  // ── Norse Myth (the Hávamál) ──────────────────────────────────
  {
    text: 'Cattle die, kinsmen die, you yourself must die; but a good name never dies for one who has earned it.',
    author: 'The Hávamál',
    world: 'norse',
  },
  {
    text: 'No better burden can a man carry on the road than a good store of common sense.',
    author: 'The Hávamál',
    world: 'norse',
  },
  {
    text: 'A coward believes he will live forever if only he can shun the fight.',
    author: 'The Hávamál',
    world: 'norse',
  },
  {
    text: 'Praise no day until evening, no sword until tested, no ice until crossed.',
    author: 'The Hávamál',
    world: 'norse',
  },
  {
    text: 'The wolf that lingers in bed seldom gets the game.',
    author: 'The Hávamál',
    world: 'norse',
  },
  {
    text: 'Wits are needful for one who travels far; at home all is easy.',
    author: 'The Hávamál',
    world: 'norse',
  },

  // ── Ancient Greece ────────────────────────────────────────────
  { text: 'Know thyself.', author: 'The Oracle at Delphi', world: 'greek' },
  {
    text: 'The only true wisdom is in knowing you know nothing.',
    author: 'Socrates',
    world: 'greek',
  },
  {
    text: 'We are what we repeatedly do; excellence, then, is not an act but a habit.',
    author: 'Aristotle',
    world: 'greek',
  },
  { text: 'No man ever steps in the same river twice.', author: 'Heraclitus', world: 'greek' },
  { text: 'There is nothing permanent except change.', author: 'Heraclitus', world: 'greek' },
  {
    text: 'The unexamined life is not worth living.',
    author: 'Socrates',
    world: 'greek',
  },
];

/**
 * Pick one quote at random. `rng` is injectable (defaults to Math.random) so
 * tests are deterministic. Falls back to the built-in bank if handed an empty
 * pool; throws only if that were empty too (it never is).
 */
export function pickRandomQuote(
  quotes: readonly Quote[] = QUOTES,
  rng: () => number = Math.random,
): Quote {
  const pool = quotes.length > 0 ? quotes : QUOTES;
  const index = Math.floor(rng() * pool.length) % pool.length;
  const chosen = pool[index];
  if (!chosen) throw new Error('quote pool is empty');
  return chosen;
}
