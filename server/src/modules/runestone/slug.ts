/**
 * Slug scheme (PLAN-07 Part B): `/runestone/<kebab-name>-<6char-id>`. The id
 * anchors the URL; the name part is cosmetic — so renames never break shared
 * links (a stale-name slug with a valid id resolves to the current slug).
 */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const RUNESTONE_ID_LENGTH = 6;

export function newRunestoneId(rng: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < RUNESTONE_ID_LENGTH; i += 1) {
    id += ID_ALPHABET[Math.floor(rng() * ID_ALPHABET.length)] ?? '0';
  }
  return id;
}

/** "Gleaming Gungnir" → "gleaming-gungnir"; diacritics stripped, ≤48 chars. */
export function kebabName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

export function makeSlug(name: string, id: string): string {
  const kebab = kebabName(name);
  return kebab ? `${kebab}-${id}` : id;
}

/**
 * The candidate id inside a slug: its last dash-segment when it is id-shaped.
 * A plain kebab word can look id-shaped too — the caller's lookup just misses.
 */
export function idFromSlug(slug: string): string | null {
  const last = slug.split('-').at(-1) ?? '';
  return new RegExp(`^[a-z0-9]{${RUNESTONE_ID_LENGTH}}$`).test(last) ? last : null;
}
