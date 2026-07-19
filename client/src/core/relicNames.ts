/**
 * Relic-name generator (PLAN-07) — client mirror of server/src/core/relics.
 * Keep the two in sync. Generates "<flavor-adjective> <Name>" titles like
 * "Gleaming Gungnir" for fresh runestone documents.
 *
 * Unrelated to assets/relics (background line art) and to relicPrefs (which
 * collections the sky shows) — this is a name bank.
 */

export type RelicCategory = 'person' | 'relic' | 'spell' | 'weapon';

export interface RelicEntry {
  name: string;
  category: RelicCategory;
}

const person = (name: string): RelicEntry => ({ name, category: 'person' });
const relic = (name: string): RelicEntry => ({ name, category: 'relic' });
const spell = (name: string): RelicEntry => ({ name, category: 'spell' });
const weapon = (name: string): RelicEntry => ({ name, category: 'weapon' });

/** Curated bank across Norse / Potter / MCU / Greek. */
export const RELIC_BANK: readonly RelicEntry[] = [
  // people
  person('Loki'),
  person('Odin'),
  person('Freya'),
  person('Heimdall'),
  person('Baldr'),
  person('Sif'),
  person('Ratatoskr'),
  person('Hermione'),
  person('Dumbledore'),
  person('Luna'),
  person('Sirius'),
  person('Fawkes'),
  person('Valkyrie'),
  person('Groot'),
  person('Nebula'),
  person('Wanda'),
  person('Athena'),
  person('Circe'),
  person('Atlas'),
  person('Achilles'),
  // objects / relics
  relic('Brísingamen'),
  relic('Draupnir'),
  relic('Gjallarhorn'),
  relic('Yggdrasil'),
  relic('Pensieve'),
  relic('Deluminator'),
  relic('Portkey'),
  relic('Remembrall'),
  relic('Horcrux'),
  relic('Snitch'),
  relic('Bezoar'),
  relic('Tesseract'),
  relic('Aether'),
  relic('Vibranium'),
  relic('Gauntlet'),
  relic('Aegis'),
  relic('Ambrosia'),
  relic('Golden Fleece'),
  // spells
  spell('Expelliarmus'),
  spell('Lumos'),
  spell('Patronus'),
  spell('Accio'),
  spell('Alohomora'),
  spell('Protego'),
  spell('Riddikulus'),
  spell('Obliviate'),
  spell('Seiðr'),
  spell('Galdr'),
  spell('Pharmakon'),
  spell('Katabasis'),
  // weapons
  weapon('Mjölnir'),
  weapon('Gungnir'),
  weapon('Hofund'),
  weapon('Stormbreaker'),
  weapon('Gram'),
  weapon('Laevateinn'),
  weapon('Dáinsleif'),
  weapon('Keraunos'),
  weapon('Harpe'),
];

export const RELIC_ADJECTIVES: readonly string[] = [
  'Gleaming',
  'Ancient',
  'Whispering',
  'Hidden',
  'Frozen',
  'Gilded',
  'Shattered',
  'Silent',
  'Blazing',
  'Wandering',
  'Forgotten',
  'Runed',
  'Emerald',
  'Thunderous',
  'Midnight',
  'Astral',
  'Molten',
  'Twilit',
  'Stormbound',
  'Hallowed',
];

function pick<T>(items: readonly T[], rng: () => number): T {
  const item = items[Math.floor(rng() * items.length)] ?? items[0];
  if (item === undefined) throw new Error('empty bank');
  return item;
}

/** One "<Adjective> <Name>" title, e.g. "Gleaming Gungnir". */
export function relicTitle(rng: () => number = Math.random): string {
  return `${pick(RELIC_ADJECTIVES, rng)} ${pick(RELIC_BANK, rng).name}`;
}

const COLLISION_ATTEMPTS = 24;

/**
 * Collision-safe variant: retries the random pattern, then falls back to a
 * short base36 suffix ("Gleaming Gungnir 7f") so it terminates even when the
 * whole bank is taken.
 */
export function uniqueRelicTitle(
  taken: ReadonlySet<string>,
  rng: () => number = Math.random,
): string {
  let title = relicTitle(rng);
  for (let i = 0; i < COLLISION_ATTEMPTS && taken.has(title); i += 1) {
    title = relicTitle(rng);
  }
  while (taken.has(title)) {
    const suffix = Math.floor(rng() * 36 ** 2)
      .toString(36)
      .padStart(2, '0');
    title = `${relicTitle(rng)} ${suffix}`;
  }
  return title;
}
