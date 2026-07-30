/**
 * URL validation + normalization for the Accio shelf (PLAN-13). Pure — no IO,
 * no config — so the whole corpus (schemes, unicode hosts, trailing junk) is
 * unit-testable and the usecase can stay a thin caller.
 *
 * Any scheme is a link — `chrome://flags`, `about:config`, `mailto:`, an app
 * deeplink — and the shelf just stores and renders it; clicking hands it to the
 * browser or the OS. The one exception is the short blocklist below.
 */

/**
 * Schemes that execute or embed content **inside the page** rather than
 * navigating away from it. These are the only ones rejected: a stored row is
 * rendered as an href, and an href must never be a script.
 */
const BLOCKED_PROTOCOLS: ReadonlySet<string> = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'blob:',
  'filesystem:',
]);

/** http(s) — the only class with a page to fetch a title from. */
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/** Longer than any real address; also the DB/JSON-schema bound. */
export const URL_MAX_LENGTH = 2048;

const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function countChar(text: string, char: string): number {
  let count = 0;
  for (const c of text) if (c === char) count += 1;
  return count;
}

/**
 * Drop sentence punctuation and unbalanced closers glued to a pasted URL's
 * tail — "see https://x.dev/a)." pastes as one token far more often than a
 * URL legitimately ends in `.` or a lone `)`.
 */
function trimTail(raw: string): string {
  let out = raw;
  for (;;) {
    const last = out.at(-1) ?? '';
    if (TRAILING_PUNCTUATION.has(last)) {
      out = out.slice(0, -1);
      continue;
    }
    const opener = CLOSERS[last];
    if (opener !== undefined && countChar(out, opener) < countChar(out, last)) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

/**
 * True when `raw` starts with a real scheme. `localhost:3000/admin` must NOT
 * count — a colon followed by digits is a port on a scheme-less host, and LAN
 * addresses like that are exactly what gets pasted onto a household shelf.
 */
function hasScheme(raw: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (!match) return false;
  const rest = raw.slice(match[0].length);
  return !/^\d/.test(rest);
}

/**
 * `raw` → a canonical absolute URL the shelf accepts, or null when it is not
 * one (the usecase turns null into a 422).
 *
 * Scheme-less input gets `https://` (typing `example.com` on a phone is the
 * common case; a plain-http host still works when typed with its scheme).
 * The WHATWG parser does the rest: host lowercasing, IDN → punycode, default
 * port removal, percent-encoding of unsafe path bytes.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = trimTail(raw.trim().replace(/^[<"']+/, '').replace(/[>"']+$/, ''));
  if (!trimmed || trimmed.length > URL_MAX_LENGTH) return null;
  // Whitespace inside an address is never valid and the parser would strip it
  // silently, turning two pasted words into one bogus host.
  if (/\s/.test(trimmed)) return null;

  const candidate = hasScheme(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (BLOCKED_PROTOCOLS.has(parsed.protocol)) return null;

  if (WEB_PROTOCOLS.has(parsed.protocol)) {
    if (!parsed.hostname) return null;
  } else {
    // `about:config` has no host and `chrome://flags` has no path — but one of
    // the two must carry the target, or this is a bare scheme naming nothing.
    if (!parsed.hostname && !parsed.pathname) return null;
    // Non-special schemes keep an opaque host verbatim, so `chrome://Flags` and
    // `chrome://flags` would become two rows for one page.
    if (parsed.hostname) parsed.hostname = parsed.hostname.toLowerCase();
  }

  // An empty fragment/query survives in `href` as a bare trailing "#"/"?" even
  // though `hash`/`search` read as '' — strip them so the same page saved twice
  // looks the same.
  const href = parsed.href.replace(/[?#]+$/, '');
  return href.length > URL_MAX_LENGTH ? null : href;
}

/**
 * True for http(s) rows — the only ones the title fetcher will touch, since
 * nothing else has a page on the network to read. Takes a normalized URL.
 */
export function isWebUrl(url: string): boolean {
  try {
    return WEB_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Display host for the shelf's letter tile: no `www.`, no port. Returns '' for
 * anything unparseable — callers render a neutral tile rather than throwing.
 */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
