/**
 * Portkey redirect-target validation (PLAN-15). Pure — no IO, no config.
 *
 * The target may point **anywhere** — the router's admin page, the NAS,
 * localhost ports, the public internet — because that is the whole use case on
 * a LAN. The one restriction is the scheme: **http(s) only**. A go-links service
 * that could emit `javascript:`/`file:`/`data:` targets would be a stored-XSS /
 * open-redirect primitive; on the LAN, an http(s) hop to any host is a
 * convenience. (The open-redirect risk is also why the module is local-only,
 * permanently — see the plan.)
 */

/** Longer than any real address; also the DB/JSON-schema bound. */
export const TARGET_MAX_LENGTH = 2048;

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * True when `raw` starts with a real scheme. `192.168.1.1:8080` must NOT count —
 * a colon followed by digits is a port on a scheme-less host, exactly what a LAN
 * target looks like.
 */
function hasScheme(raw: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (!match) return false;
  return !/^\d/.test(raw.slice(match[0].length));
}

/**
 * `raw` → a canonical absolute http(s) URL, or null when it is not one (the
 * usecase turns null into a 422). Scheme-less input gets `https://` (type
 * `example.com` or `192.168.1.1` and it just works; a plain-http device still
 * works when its `http://` scheme is typed). The WHATWG parser handles host
 * lowercasing, IDN → punycode, default-port removal and percent-encoding.
 */
export function normalizeTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > TARGET_MAX_LENGTH) return null;
  // Whitespace inside an address is never valid; the parser would strip it
  // silently and turn two words into one bogus host.
  if (/\s/.test(trimmed)) return null;

  const candidate = hasScheme(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (!WEB_PROTOCOLS.has(parsed.protocol)) return null;
  if (!parsed.hostname) return null;

  return parsed.href.length > TARGET_MAX_LENGTH ? null : parsed.href;
}
