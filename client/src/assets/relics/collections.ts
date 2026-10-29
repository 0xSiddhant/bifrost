/**
 * The relic collections by name, without their drawings (PLAN-41). The shell
 * needs the names on every page (`core/relicPrefs.ts` reads the visitor's
 * choice from them), while the 115 drawings in `index.ts` load in their own
 * chunk after the first render, so the names live apart from them.
 */
export type RelicCollection = 'norse' | 'wizarding' | 'olympus' | 'ghibli' | 'halloween';

/** Every collection, in the order Heimdall lists them. */
export const ALL_COLLECTIONS: readonly RelicCollection[] = [
  'norse',
  'wizarding',
  'olympus',
  'ghibli',
  'halloween',
];
