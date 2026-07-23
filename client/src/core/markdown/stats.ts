/** Document metrics for the Edda status bar (PLAN-11). */
export interface DocStats {
  words: number;
  /** Unicode code points, so emoji count as one. */
  chars: number;
  /** Estimated reading time in minutes at ~200 wpm; 0 for an empty doc. */
  readingMinutes: number;
}

const WORDS_PER_MINUTE = 200;

export function stats(md: string): DocStats {
  const words = (md.trim().match(/\S+/g) ?? []).length;
  const chars = [...md].length;
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return { words, chars, readingMinutes };
}
