/**
 * `<title>` extraction from a fetched HTML page (PLAN-13). Pure string work —
 * the network half lives in services/http-title-fetcher.ts, so every awkward
 * page shape (entities, no title, an SVG title, a truncated download) is a
 * plain unit test.
 *
 * Deliberately regex-based, not a parser: we read at most the first chunk of a
 * page and only ever want one element from it. A malformed tail is normal here.
 */

/** Titles longer than this are site boilerplate, not information. */
export const TITLE_MAX_LENGTH = 200;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** Decodes the handful of entities that actually show up in page titles. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      // Surrogates and out-of-range code points would throw; leave them literal.
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * The page's title, or null when it has none. Prefers a `<title>` inside
 * `<head>` — an inline `<svg><title>` in the body must not win.
 */
export function extractTitle(html: string): string | null {
  const headEnd = html.search(/<\/head\s*>/i);
  const searchIn = headEnd === -1 ? html : html.slice(0, headEnd);

  const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/i.exec(searchIn);
  if (!match?.[1]) return null;

  const text = decodeEntities(match[1])
    // Titles are text-only, but stray markup and newlines do appear.
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…` : text;
}
