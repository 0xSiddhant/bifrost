/**
 * Slug scheme (PLAN-23): `/atlas/<kebab-name>-<6char-id>`. The id anchors the
 * URL; the name part is cosmetic — so renames never break shared links (a
 * stale-name slug with a valid id resolves to the current slug).
 *
 * Mirrors the runestone, edda and groot slug shapes, but modules never import
 * each other, so this is Atlas's own copy — the same duplication `groot/slug.ts`
 * already makes of `edda/slug.ts`.
 */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const ATLAS_ID_LENGTH = 6;

/** First path segments that route to Atlas's non-document surfaces, not a slug. */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(['api', 'library', 'pensieve']);

export function newAtlasId(rng: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < ATLAS_ID_LENGTH; i += 1) {
    id += ID_ALPHABET[Math.floor(rng() * ID_ALPHABET.length)] ?? '0';
  }
  return id;
}

/** "Bundle Info" → "bundle-info"; diacritics stripped, ≤48 chars. */
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
  return new RegExp(`^[a-z0-9]{${ATLAS_ID_LENGTH}}$`).test(last) ? last : null;
}

/**
 * A reserved bare segment (no id tail) must never resolve as a document slug.
 * Real slugs always carry a `-<id>` tail so `api`/`library`/`pensieve` can't
 * collide in practice — but the guard is explicit rather than relying on that.
 */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SEGMENTS.has(slug) && idFromSlug(slug) === null;
}
