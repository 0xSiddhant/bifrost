/**
 * Tag normalization for the shelf (PLAN-13). Tags are flat and free-form — no
 * folders, no nesting — so the only structure is this: they are compared
 * case-insensitively, so "Recipes" and "recipes" must never become two chips.
 */

/** Per tag; longer strings are sentences, not labels. */
export const TAG_MAX_LENGTH = 24;
/** Per link; a shelf row with more tags than this is uncategorized by another name. */
export const TAG_MAX_COUNT = 8;

/**
 * Trims, lowercases, collapses inner whitespace, drops empties and duplicates,
 * and caps both tag length and tag count. Order of first appearance is kept —
 * the chip row should read the way the user typed it.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, TAG_MAX_LENGTH).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === TAG_MAX_COUNT) break;
  }
  return out;
}
