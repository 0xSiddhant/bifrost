/**
 * The three settings the page offers, and what each one is for.
 *
 * The client never sends a raw 0–11 Brotli level: it sends one of these names
 * and the server maps it, so there is nothing to sanity-check on the wire
 * beyond "is this one of three strings".
 *
 * **Balanced is the default, not Best.** Node's own library default is quality
 * 11, which is meaningfully slower on large inputs — defaulting a tool whose
 * whole point is a quick round trip to its slowest setting is the wrong
 * default. The slowest option earns the label "Best"; it does not earn being
 * automatic.
 */
export const QUALITIES = [
  { name: 'fast', label: 'Fast', level: 4, hint: 'quickest, largest output' },
  { name: 'balanced', label: 'Balanced', level: 9, hint: 'the default — good ratio, quick' },
  { name: 'best', label: 'Best', level: 11, hint: 'smallest output, slowest' },
] as const;

export type BrotliQualityName = (typeof QUALITIES)[number]['name'];

export const DEFAULT_QUALITY: BrotliQualityName = 'balanced';

export function qualityLabel(name: BrotliQualityName): string {
  return QUALITIES.find((quality) => quality.name === name)?.label ?? name;
}

export function qualityLevel(name: BrotliQualityName): number {
  return QUALITIES.find((quality) => quality.name === name)?.level ?? 9;
}
