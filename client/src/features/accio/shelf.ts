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

/** Every tag on the shelf, alphabetical — the chip filter row. */
export function allTags(links: readonly AccioLink[]): string[] {
  const tags = new Set<string>();
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
 * Search and tag filter **compose** (acceptance criterion 2): a row must match
 * both to survive. Applied client-side over the SSE-maintained list so a live
 * insert can be placed without a refetch — see decisions.md.
 */
export function filterLinks(links: readonly AccioLink[], filter: ShelfFilter): AccioLink[] {
  const needle = filter.q.trim().toLowerCase();
  return links.filter((link) => {
    if (filter.tag && !link.tags.includes(filter.tag)) return false;
    if (!needle) return true;
    return (
      link.url.toLowerCase().includes(needle) ||
      (link.title?.toLowerCase().includes(needle) ?? false)
    );
  });
}

export type ShelfSort = 'newest' | 'oldest' | 'title';

/** Newest first by default — a read-later shelf is a stack, not an archive. */
export function sortLinks(links: readonly AccioLink[], sort: ShelfSort): AccioLink[] {
  const rows = [...links];
  if (sort === 'title') {
    return rows.sort((a, b) =>
      displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' }),
    );
  }
  return rows.sort((a, b) => (sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
}

/** Splits a free-text tag field ("recipes, later") into tags for the API. */
export function parseTagInput(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
