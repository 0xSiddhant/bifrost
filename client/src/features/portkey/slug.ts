/**
 * Client-side slug validation, mirroring server/src/modules/portkey/slug.ts for
 * live feedback in the create bar. The server is authoritative — it also rejects
 * reserved words (which need the core route-root list) — so this only covers the
 * format so the "Enchant" button and inline hint react as the user types.
 */

export const SLUG_MAX_LENGTH = 32;

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Lowercases and strips characters a slug can't contain — a paste-friendly nudge. */
export function tidySlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX_LENGTH);
}

/** null = the format is fine (or the field is empty); else a short reason. */
export function slugFormatError(raw: string): string | null {
  const slug = raw.trim();
  if (!slug) return null;
  if (slug.length > SLUG_MAX_LENGTH) return `${SLUG_MAX_LENGTH} characters max`;
  if (!SLUG_PATTERN.test(slug)) return 'lowercase letters, digits and dashes only';
  return null;
}

export function isValidSlugFormat(raw: string): boolean {
  const slug = raw.trim();
  return slug.length > 0 && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}
