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

/**
 * When a chosen slug is taken, offer the nearest still-memorable variant rather
 * than a random id (the whole feature is memorability): `router` → `router-2`,
 * `router-3`, … A numeric suffix keeps the word readable; the base is trimmed so
 * the result never exceeds the length cap, and a short random tail is the last
 * resort if every `-N` up to 99 is somehow taken.
 */
export function suggestSlug(base: string, taken: ReadonlySet<string>): string {
  const clean = base.trim().replace(/-+$/, '');

  const withSuffix = (suffix: string): string => {
    const room = Math.max(1, SLUG_MAX_LENGTH - suffix.length);
    return `${clean.slice(0, room).replace(/-+$/, '')}${suffix}`;
  };

  for (let n = 2; n <= 99; n += 1) {
    const candidate = withSuffix(`-${n}`);
    if (!taken.has(candidate)) return candidate;
  }
  for (let i = 0; i < 50; i += 1) {
    const candidate = withSuffix(`-${Math.random().toString(36).slice(2, 5)}`);
    if (!taken.has(candidate)) return candidate;
  }
  return withSuffix(`-${Math.random().toString(36).slice(2, 6)}`);
}
