/**
 * String-oriented JS transforms (Loki, PLAN-12) — all pure, no `eval`.
 *
 * `stringifyJs` / `destringifyJs` are inverses (property-tested): stringify
 * wraps arbitrary source in a quoted literal; destringify lexes a quoted
 * literal back to its raw value. Escapes and quote conversion round-trip too.
 */

import { scanJs } from './scan';

export type QuoteStyle = 'single' | 'double' | 'backtick' | 'json';

const QUOTE_CHAR: Record<Exclude<QuoteStyle, 'json'>, "'" | '"' | '`'> = {
  single: "'",
  double: '"',
  backtick: '`',
};

/** Escape one raw string into a literal of the given quote style. */
export function stringifyJs(raw: string, style: QuoteStyle = 'double'): string {
  if (style === 'json') return JSON.stringify(raw);
  const quote = QUOTE_CHAR[style];
  let out = quote;
  for (const ch of raw) {
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\f':
        out += '\\f';
        break;
      case '\n':
        // Template literals keep real newlines; quoted strings escape them.
        out += style === 'backtick' ? '\n' : '\\n';
        break;
      case '`':
        out += style === 'backtick' ? '\\`' : '`';
        break;
      case '$':
        out += style === 'backtick' ? '\\$' : '$';
        break;
      case quote:
        out += '\\' + quote;
        break;
      default:
        out += ch;
    }
  }
  return out + quote;
}

/** Decode a single escape sequence; returns the char + how many source chars consumed after the backslash. */
function decodeEscape(body: string, at: number): { value: string; consumed: number } {
  const c = body[at];
  switch (c) {
    case 'n':
      return { value: '\n', consumed: 1 };
    case 'r':
      return { value: '\r', consumed: 1 };
    case 't':
      return { value: '\t', consumed: 1 };
    case 'b':
      return { value: '\b', consumed: 1 };
    case 'f':
      return { value: '\f', consumed: 1 };
    case 'v':
      return { value: '\v', consumed: 1 };
    case '0':
      // \0 only when not followed by another digit (else octal, unsupported)
      if (!/[0-9]/.test(body[at + 1] ?? '')) return { value: '\0', consumed: 1 };
      return { value: '0', consumed: 1 };
    case 'x': {
      const hex = body.slice(at + 1, at + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        return { value: String.fromCharCode(parseInt(hex, 16)), consumed: 3 };
      }
      return { value: 'x', consumed: 1 };
    }
    case 'u': {
      if (body[at + 1] === '{') {
        const close = body.indexOf('}', at + 2);
        const hex = close === -1 ? '' : body.slice(at + 2, close);
        if (close !== -1 && /^[0-9a-fA-F]+$/.test(hex)) {
          return { value: String.fromCodePoint(parseInt(hex, 16)), consumed: close - at + 1 };
        }
        return { value: 'u', consumed: 1 };
      }
      const hex = body.slice(at + 1, at + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        return { value: String.fromCharCode(parseInt(hex, 16)), consumed: 5 };
      }
      return { value: 'u', consumed: 1 };
    }
    case '\n':
      return { value: '', consumed: 1 }; // line continuation
    case '\r':
      return { value: '', consumed: body[at + 1] === '\n' ? 2 : 1 };
    default:
      return { value: c ?? '', consumed: 1 };
  }
}

/**
 * Lex a quoted string / template literal back to its raw value. Never `eval`s.
 * Accepts leading/trailing whitespace around the literal. Throws if the input
 * is not a single quoted literal.
 */
export function destringifyJs(literal: string): string {
  const trimmed = literal.trim();
  const quote = trimmed[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    throw new Error('Not a quoted string literal (expected \', ", or `).');
  }
  if (trimmed[trimmed.length - 1] !== quote || trimmed.length < 2) {
    throw new Error('Unterminated string literal.');
  }
  const body = trimmed.slice(1, -1);
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body.charAt(i);
    if (ch === '\\') {
      const { value, consumed } = decodeEscape(body, i + 1);
      out += value;
      i += 1 + consumed;
      continue;
    }
    // A bare, un-escaped closing quote inside means it wasn't a single literal.
    if (ch === quote) throw new Error('Unexpected quote inside literal.');
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Is the whole buffer already a single quoted string literal? (i.e. would
 * `destringifyJs` succeed on it.) Loki uses this so tapping Stringify twice
 * doesn't keep nesting `"…"` — the buffer is already a literal, so the next
 * step is Destringify.
 */
export function isSingleStringLiteral(text: string): boolean {
  if (text.trim() === '') return false;
  try {
    destringifyJs(text);
    return true;
  } catch {
    return false;
  }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const HTML_UNESCAPES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
};

export function htmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

export function htmlUnescape(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return HTML_UNESCAPES[name] ?? whole;
  });
}

export function uriEncode(text: string): string {
  return encodeURIComponent(text);
}

export function uriDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    throw new Error('Malformed percent-encoding — cannot decode.');
  }
}

/**
 * Convert every single-quoted string literal to double, or vice-versa —
 * literal-aware (templates, regex, comments, and the other quote style are
 * left untouched), re-escaping the delimiters correctly.
 */
export function convertQuotes(code: string, to: 'single' | 'double'): string {
  const target = to === 'single' ? "'" : '"';
  const source = to === 'single' ? '"' : "'";
  let out = '';
  for (const seg of scanJs(code)) {
    const slice = code.slice(seg.start, seg.end);
    if (seg.type !== 'string' || seg.quote !== source) {
      out += slice;
      continue;
    }
    const raw = destringifyJs(slice);
    out += stringifyJs(raw, target === "'" ? 'single' : 'double');
  }
  return out;
}
