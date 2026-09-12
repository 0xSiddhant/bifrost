/**
 * URL encoding, parsing, and HTML entities (PLAN-18).
 */

export type UrlMode = 'component' | 'full' | 'html';

export interface QueryParam {
  key: string;
  value: string;
}

export interface UrlParts {
  scheme: string;
  username: string;
  password: string;
  host: string;
  port: string;
  path: string;
  params: QueryParam[];
  hash: string;
}

/** The five characters that change meaning when a string is dropped in HTML. */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function encodeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
}

export function decodeHtml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => {
      switch (name) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          return ' ';
      }
    });
}

export interface UrlResult {
  value: string;
  error: string | null;
}

/**
 * `component` escapes `&`, `=`, `?`, `/` — for a value going *inside* a query
 * string. `full` leaves the URL's own delimiters alone — for escaping a URL
 * that is already assembled. Choosing the wrong one is the mistake this tool
 * exists to make visible, so both are on screen at once.
 */
export function runUrl(input: string, mode: UrlMode, direction: 'encode' | 'decode'): UrlResult {
  if (!input) return { value: '', error: null };
  try {
    if (mode === 'html') {
      return { value: direction === 'encode' ? encodeHtml(input) : decodeHtml(input), error: null };
    }
    if (direction === 'encode') {
      return {
        value: mode === 'component' ? encodeURIComponent(input) : encodeURI(input),
        error: null,
      };
    }
    return { value: mode === 'component' ? decodeURIComponent(input) : decodeURI(input), error: null };
  } catch {
    // decodeURIComponent throws URIError on a truncated escape like "%E0%A4".
    return {
      value: '',
      error: 'That is not a valid percent-encoded string — check for a stray % or a truncated escape.',
    };
  }
}

/**
 * Split a URL into its parts. Uses the platform parser rather than a regex, so
 * IDN hosts, IPv6 literals and default ports behave the way the browser will.
 */
export function parseUrl(input: string): UrlParts | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const params: QueryParam[] = [];
  url.searchParams.forEach((value, key) => params.push({ key, value }));
  return {
    scheme: url.protocol.replace(/:$/, ''),
    username: url.username,
    password: url.password,
    host: url.hostname,
    port: url.port,
    path: url.pathname,
    params,
    hash: url.hash.replace(/^#/, ''),
  };
}

/** Rebuild a URL from edited parts — the other half of the param table. */
export function buildUrl(parts: UrlParts): string {
  const auth = parts.username
    ? `${parts.username}${parts.password ? `:${parts.password}` : ''}@`
    : '';
  const port = parts.port ? `:${parts.port}` : '';
  const query = parts.params
    .filter((param) => param.key !== '')
    .map((param) => `${encodeURIComponent(param.key)}=${encodeURIComponent(param.value)}`)
    .join('&');
  const path = parts.path.startsWith('/') || parts.path === '' ? parts.path : `/${parts.path}`;
  return (
    `${parts.scheme}://${auth}${parts.host}${port}${path}` +
    (query ? `?${query}` : '') +
    (parts.hash ? `#${parts.hash}` : '')
  );
}
