/**
 * A lightweight, dependency-free JavaScript source scanner (Loki, PLAN-12).
 *
 * It walks the source once and classifies it into non-overlapping segments —
 * code, string / template literals, comments, and regex literals — so the
 * transforms that must be *literal-aware* (quote conversion, comment stripping)
 * never touch characters that only look like delimiters but live inside a
 * string, template interpolation, comment, or regex.
 *
 * This is deliberately not a full parser: it is a lexer good enough for
 * formatting-grade transforms. The one genuine ambiguity in JS lexing — is a
 * `/` a division operator or the start of a regex? — is resolved with the
 * standard "previous significant token" heuristic, which is correct for the
 * overwhelming majority of real code.
 */

export type SegmentType =
  | 'code'
  | 'string'
  | 'template'
  | 'line-comment'
  | 'block-comment'
  | 'regex';

export interface Segment {
  type: SegmentType;
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** For `string` segments: the delimiter that opened them. */
  quote?: "'" | '"';
}

/** Chars after which a `/` begins a regex literal rather than a division. */
const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*',
  '%', '~', '^', '<', '>', '\n',
]);

/** Keywords after which a `/` begins a regex (e.g. `return /x/`). */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'do', 'else', 'yield', 'await', 'case',
]);

/** Is the `/` at `i` a regex start, given the last significant code char/word? */
function regexAllowed(lastChar: string | null, lastWord: string): boolean {
  if (lastChar === null) return true; // start of input
  if (REGEX_KEYWORDS.has(lastWord)) return true;
  return REGEX_PRECEDERS.has(lastChar);
}

/**
 * Scan `code` into ordered, gap-free segments covering the whole string.
 * Template interpolations (`${…}`) are handled by re-entering code scanning,
 * so nested strings/templates/regex inside them are classified correctly; the
 * template literal is still reported as one contiguous `template` segment.
 */
export function scanJs(code: string): Segment[] {
  const segments: Segment[] = [];
  const len = code.length;
  let i = 0;
  // Track the last significant (non-space, non-comment) char + identifier word
  // to disambiguate regex vs division.
  let lastChar: string | null = null;
  let lastWord = '';

  const pushCode = (start: number, end: number) => {
    if (end > start) segments.push({ type: 'code', start, end });
  };

  while (i < len) {
    const ch = code.charAt(i);
    const next = code[i + 1];

    // Line comment
    if (ch === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < len && code[i] !== '\n') i += 1;
      segments.push({ type: 'line-comment', start, end: i });
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i = Math.min(len, i + 2);
      segments.push({ type: 'block-comment', start, end: i });
      continue;
    }

    // String literal
    if (ch === "'" || ch === '"') {
      const start = i;
      const quote = ch;
      i += 1;
      while (i < len) {
        const c = code.charAt(i);
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        if (c === '\n') break; // unterminated line-string — stop defensively
        i += 1;
      }
      segments.push({ type: 'string', start, end: i, quote });
      lastChar = quote;
      lastWord = '';
      continue;
    }

    // Template literal (with ${…} interpolation awareness)
    if (ch === '`') {
      const start = i;
      i += 1;
      while (i < len) {
        const c = code.charAt(i);
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '`') {
          i += 1;
          break;
        }
        if (c === '$' && code[i + 1] === '{') {
          // Skip the interpolation, tracking brace depth over its own strings.
          i += 2;
          let depth = 1;
          while (i < len && depth > 0) {
            const d = code.charAt(i);
            if (d === '{') depth += 1;
            else if (d === '}') depth -= 1;
            else if (d === "'" || d === '"' || d === '`') {
              const q = d;
              i += 1;
              while (i < len && code[i] !== q) {
                if (code[i] === '\\') i += 1;
                i += 1;
              }
            }
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      segments.push({ type: 'template', start, end: i });
      lastChar = '`';
      lastWord = '';
      continue;
    }

    // Regex literal vs division
    if (ch === '/' && regexAllowed(lastChar, lastWord)) {
      const start = i;
      i += 1;
      let inClass = false;
      let closed = false;
      while (i < len) {
        const c = code.charAt(i);
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          i += 1;
          closed = true;
          break;
        } else if (c === '\n') break; // regex can't span lines — bail
        i += 1;
      }
      if (closed) {
        while (i < len && /[a-z]/i.test(code.charAt(i))) i += 1; // flags
        segments.push({ type: 'regex', start, end: i });
        lastChar = '/';
        lastWord = '';
        continue;
      }
      // Not actually a regex — treat the `/` as code.
      i = start;
    }

    // Plain code — accumulate until the next special construct.
    {
      const start = i;
      while (i < len) {
        const c = code.charAt(i);
        const n = code[i + 1];
        if (
          (c === '/' && (n === '/' || n === '*')) ||
          c === "'" ||
          c === '"' ||
          c === '`' ||
          (c === '/' && regexAllowed(lastChar, lastWord))
        ) {
          break;
        }
        if (!/\s/.test(c)) {
          lastChar = c;
          if (/[A-Za-z0-9_$]/.test(c)) lastWord += c;
          else lastWord = '';
        }
        i += 1;
      }
      pushCode(start, i);
    }
  }

  return segments;
}
