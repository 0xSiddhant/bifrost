/**
 * Slug scheme (PLAN-11): `/edda/<kebab-name>-<6char-id>`. The id anchors the
 * URL; the name part is cosmetic — so renames never break shared links (a
 * stale-name slug with a valid id resolves to the current slug).
 *
 * Mirrors the runestone slug shape, but modules never import each other, so
 * this is Edda's own copy (plus the reserved-first-segment guard the three
 * URL surfaces need — `preview`, `api`, `library`).
 */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const EDDA_ID_LENGTH = 6;

/** First path segments that route to Edda's non-document surfaces, not a slug. */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  'preview',
  'api',
  'library',
  'pensieve',
]);

export function newEddaId(rng: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < EDDA_ID_LENGTH; i += 1) {
    id += ID_ALPHABET[Math.floor(rng() * ID_ALPHABET.length)] ?? '0';
  }
  return id;
}

/** "The Prose Edda" → "the-prose-edda"; diacritics stripped, ≤48 chars. */
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
  return new RegExp(`^[a-z0-9]{${EDDA_ID_LENGTH}}$`).test(last) ? last : null;
}

/**
 * A reserved bare segment (no id tail) must never resolve as a document slug.
 * Real slugs always carry a `-<id>` tail so `preview`/`api`/`library` can't
 * collide in practice — but the guard is explicit rather than relying on that.
 */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SEGMENTS.has(slug) && idFromSlug(slug) === null;
}
