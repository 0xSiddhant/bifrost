// Pure link tokenizer for Hermes text entries. Splits a shared text into
// text/link tokens so the page can render tappable anchors without touching
// the stored entry. Code-snippet entries never pass through this.

export interface LinkToken {
  type: 'link';
  text: string;
  href: string;
}

export interface TextToken {
  type: 'text';
  text: string;
}

export type LinkifyToken = LinkToken | TextToken;

// Schemes that must never become tappable — they execute or exfiltrate
// instead of navigating.
const BLOCKED_SCHEMES = new Set([
  'javascript',
  'data',
  'vbscript',
  'file',
  'blob',
  'about',
  'filesystem',
]);

// scheme://anything — covers http(s), ftp, and app deeplinks (spotify://…,
// myapp://path). Scheme syntax per RFC 3986.
const SCHEME_URL = String.raw`[a-z][a-z0-9+.-]*://[^\s<>"'\`]+`;

// Opaque (no //) schemes that phones and desktops commonly handle.
const OPAQUE_URL = String.raw`(?:mailto|tel|sms|smsto|callto|facetime|facetime-audio|geo|maps|whatsapp|skype|spotify|zoommtg|slack|market|itms-apps|magnet|webcal|bitcoin):[^\s<>"'\`]+`;

const EMAIL = String.raw`[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+`;

const WWW_URL = String.raw`www\.[^\s<>"'\`]+`;

// Bare domains only for common TLDs — anything broader turns filenames
// ("notes.md") into links.
const BARE_DOMAIN = String.raw`(?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|in|co|uk|dev|app|me|ai|edu|gov|info|biz|xyz|tech|cloud|local)(?::\d{2,5})?(?:/[^\s<>"'\`]*)?`;

// Phone candidates: digits with space/dash/paren separators (no dots — dots
// match decimals, versions, IPs). Validated further in code.
const PHONE = String.raw`(?<![\w@.+/-])\+?\(?\d[\d ()-]{4,17}\d(?![\w-])`;

const LINK_PATTERN = new RegExp(
  `(?<scheme>${SCHEME_URL})|(?<opaque>${OPAQUE_URL})|(?<email>${EMAIL})|(?<www>${WWW_URL})|(?<domain>${BARE_DOMAIN})|(?<phone>${PHONE})`,
  'gi',
);

const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function countChar(text: string, char: string): number {
  let count = 0;
  for (const c of text) if (c === char) count += 1;
  return count;
}

/** Drop sentence punctuation and unbalanced closers glued to a URL's tail. */
function trimUrlTail(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1] ?? '';
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

function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  // Bare digit runs shorter than a full mobile number are more likely ids,
  // dates, or amounts — require an explicit phone shape for those.
  return raw.startsWith('+') || raw.startsWith('(') || digits.length >= 10;
}

function phoneHref(raw: string): string {
  return `tel:${raw.startsWith('+') ? '+' : ''}${raw.replace(/\D/g, '')}`;
}

/** True when the href is a web URL that should open in a new tab (app
 *  deeplinks and tel:/mailto: hand off to the OS instead). */
export function opensInNewTab(href: string): boolean {
  return /^(?:https?|ftp):/i.test(href);
}

/** Split text into text/link tokens. Never throws; returns the whole input
 *  as one text token when nothing looks like a link. */
export function linkify(text: string): LinkifyToken[] {
  const tokens: LinkifyToken[] = [];
  let cursor = 0;
  LINK_PATTERN.lastIndex = 0;

  for (let match = LINK_PATTERN.exec(text); match; match = LINK_PATTERN.exec(text)) {
    const groups = match.groups ?? {};
    let matched = match[0];
    let href: string | null = null;

    if (groups['scheme'] || groups['opaque'] || groups['www'] || groups['domain']) {
      matched = trimUrlTail(matched);
      LINK_PATTERN.lastIndex = match.index + matched.length;
      if (groups['scheme']) {
        const scheme = matched.slice(0, matched.indexOf(':')).toLowerCase();
        href = BLOCKED_SCHEMES.has(scheme) ? null : matched;
      } else if (groups['opaque']) {
        href = matched;
      } else {
        href = `https://${matched}`;
      }
    } else if (groups['email']) {
      href = `mailto:${matched}`;
    } else if (groups['phone']) {
      href = isValidPhone(matched) ? phoneHref(matched) : null;
    }

    if (!href) continue;
    if (match.index > cursor) tokens.push({ type: 'text', text: text.slice(cursor, match.index) });
    tokens.push({ type: 'link', text: matched, href });
    cursor = match.index + matched.length;
  }

  if (cursor < text.length) tokens.push({ type: 'text', text: text.slice(cursor) });
  return tokens;
}
