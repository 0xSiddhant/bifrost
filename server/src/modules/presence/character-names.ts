/**
 * A pool of famous character names (PLAN-06). Every device gets a unique random
 * alias from here on first sighting, so it's identifiable by "Thor" or
 * "Hermione" instead of a raw id or UA string. Heimdall shows the alias plus
 * the original UA label; everywhere else shows just the alias.
 */
const POTTER = [
  'Harry', 'Hermione', 'Ron', 'Dumbledore', 'Snape', 'Hagrid', 'Sirius', 'Luna',
  'Neville', 'Ginny', 'Draco', 'McGonagall', 'Dobby', 'Bellatrix', 'Fawkes',
  'Buckbeak', 'Remus', 'Tonks', 'Kreacher', 'Moody', 'Cedric', 'Fleur', 'Slughorn',
];

const NORSE = [
  'Odin', 'Thor', 'Loki', 'Freya', 'Baldr', 'Tyr', 'Frigg', 'Sif', 'Njord',
  'Fenrir', 'Jormungandr', 'Sleipnir', 'Hel', 'Skadi', 'Bragi', 'Idunn', 'Vidar',
  'Vali', 'Forseti', 'Ullr', 'Ratatoskr', 'Huginn', 'Muninn', 'Surtr',
];

const MCU = [
  'Iron Man', 'Hulk', 'Black Widow', 'Hawkeye', 'Captain America', 'Vision',
  'Scarlet Witch', 'Falcon', 'Winter Soldier', 'Star-Lord', 'Gamora', 'Rocket',
  'Groot', 'Drax', 'Nebula', 'Doctor Strange', 'Spider-Man', 'Black Panther',
  'Shuri', 'Wong', 'Valkyrie', 'Okoye', 'Mantis', 'Yondu',
];

/** Deduplicated pool across the three universes. */
export const CHARACTER_NAMES: readonly string[] = [...new Set([...POTTER, ...NORSE, ...MCU])];

/**
 * Pick a name not already taken by another device. Falls back to a numbered
 * "Traveler" if the pool is exhausted (more devices than characters).
 */
export function pickCharacterName(
  used: ReadonlySet<string>,
  rng: () => number = Math.random,
): string {
  const available = CHARACTER_NAMES.filter((name) => !used.has(name));
  const first = available[0];
  if (first !== undefined) {
    return available[Math.floor(rng() * available.length)] ?? first;
  }
  let n = used.size + 1;
  while (used.has(`Traveler ${n}`)) n += 1;
  return `Traveler ${n}`;
}
