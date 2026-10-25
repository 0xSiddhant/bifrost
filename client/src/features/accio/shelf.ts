import type { AccioLink } from '../../core/accio';

/**
 * Pure shelf helpers (PLAN-13). Filtering, sorting and the hostname tile all
 * live here so the page component stays presentational and every rule below is
 * a plain unit test.
 */

/**
 * Display host for the tile and the meta row: no `www.`, no port. Empty for a
 * hostless URL like `about:config` — the row then shows the address itself.
 */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The tile glyph: first letter of the host, uppercased. '·' when unknowable. */
export function tileLetter(url: string): string {
  const letter = [...hostnameOf(url)].find((ch) => /[a-z0-9]/i.test(ch));
  return letter ? letter.toUpperCase() : '·';
}

/**
 * Which of the 10 card-palette slots a link's tile uses. Derived from the
 * hostname, not the render index (the house rule for hub cards), so a site
 * keeps the same colour as the shelf is filtered and re-sorted — that
 * stability is the whole point of the tile. Logged in decisions.md.
 */
export function tileTone(url: string): number {
  const host = hostnameOf(url);
  if (!host) return 1;
  let hash = 0;
  for (const ch of host) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 100000;
  return (hash % 10) + 1;
}

/** What the row shows as its heading — the title, or the URL without its scheme. */
export function displayTitle(link: AccioLink): string {
  if (link.title) return link.title;
  return link.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * The tag chip row: the whole shelf's tags from the server's facet, plus any a
 * live save introduced since that fetch, alphabetical.
 */
export function unionTags(facet: readonly string[], links: readonly AccioLink[]): string[] {
  const tags = new Set(facet);
  for (const link of links) for (const tag of link.tags) tags.add(tag);
  return [...tags].sort((a, b) => a.localeCompare(b));
}

export interface ShelfFilter {
  /** Free text; matches the title and the URL, case-insensitively. */
  q: string;
  /** Exact tag, or null for "everything". */
  tag: string | null;
}

/**
 * Does one link pass the search and tag filter? Search and tag **compose**
 * (PLAN-13 criterion 2). Since PLAN-31 the server filters the shelf itself;
 * this survives only as the predicate for a *live* SSE row, deciding whether it
 * belongs in the list on screen. For a non-ASCII search its Unicode case
 * folding can disagree with SQLite's ASCII-only `LIKE`, which at worst
 * mis-places one live row until the next fetch.
 */
export function linkMatches(link: AccioLink, filter: ShelfFilter): boolean {
  if (filter.tag && !link.tags.includes(filter.tag)) return false;
  const needle = filter.q.trim().toLowerCase();
  if (!needle) return true;
  return (
    link.url.toLowerCase().includes(needle) || (link.title?.toLowerCase().includes(needle) ?? false)
  );
}

export type ShelfSort = 'newest' | 'oldest' | 'title';

/** The server sort each shelf chip asks for (PLAN-31: one order, the server's). */
export const SHELF_SORTS: Record<ShelfSort, { sort: 'created' | 'title'; order: 'asc' | 'desc' }> =
  {
    newest: { sort: 'created', order: 'desc' },
    oldest: { sort: 'created', order: 'asc' },
    title: { sort: 'title', order: 'asc' },
  };

/** SQLite's `lower()`: ASCII only. */
const asciiLower = (text: string) =>
  text.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));

/**
 * The server's paged order, for placing a live row among the loaded ones:
 * `created_at` or `lower(coalesce(title, url))`, then `id`, both in the sort
 * direction. Newest-first by default — a read-later shelf is a stack.
 */
export function compareLinks(a: AccioLink, b: AccioLink, sort: ShelfSort): number {
  const { order } = SHELF_SORTS[sort];
  const direction = order === 'asc' ? 1 : -1;
  const key =
    sort === 'title'
      ? (link: AccioLink) => asciiLower(link.title ?? link.url)
      : (link: AccioLink) => link.createdAt;
  const left = key(a);
  const right = key(b);
  if (left !== right) return (left < right ? -1 : 1) * direction;
  if (a.id === b.id) return 0;
  return (a.id < b.id ? -1 : 1) * direction;
}

/** Splits a free-text tag field ("recipes, later") into tags for the API. */
export function parseTagInput(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
