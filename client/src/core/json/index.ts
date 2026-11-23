import {
  applyEdits,
  createScanner,
  findNodeAtLocation,
  format,
  getLocation,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from 'jsonc-parser';

import { PARSE_OPTIONS, minifyJsonc, sortJsoncKeys, toStrictJson, type JsonFormat } from './jsonc';
import { sortKeysDeep } from './sortKeys';

export { sortKeysDeep } from './sortKeys';
export {
  FORMAT_FILE,
  JSON_FORMATS,
  asJsonFormat,
  minifyJsonc,
  toStrictJson,
  type JsonFormat,
} from './jsonc';

// jsonc-parser publishes ScanError/SyntaxKind as ambient const enums, which
// isolatedModules cannot import — these are their published numeric values.
const SCAN_ERROR_NONE = 0; // ScanError.None
const SYNTAX_KIND_EOF = 17; // SyntaxKind.EOF

/**
 * Pure JSON document utilities (PLAN-07). Shared surface: the Runestone editor
 * uses all of these; PLAN-08's diff checker reuses sortKeysDeep/formatJson.
 *
 * Built on jsonc-parser (VS Code's error-tolerant parser) so format/minify
 * preserve the document's raw tokens — key order and number precision survive
 * untouched, unlike a JSON.parse/stringify round-trip.
 *
 * Every reader takes a `format` (PLAN-42) and defaults to strict JSON, so a
 * caller that names none behaves exactly as before JSONC existed.
 */

export interface JsonIssue {
  offset: number;
  length: number;
  message: string;
}

/** printParseErrorCode returns enum names ("PropertyNameExpected") — humanize them. */
const ERROR_MESSAGES: Record<string, string> = {
  InvalidSymbol: 'Unexpected token',
  InvalidNumberFormat: 'Malformed number',
  PropertyNameExpected: 'Expected a property name in double quotes',
  ValueExpected: 'Expected a value',
  ColonExpected: 'Expected ":" after the property name',
  CommaExpected: 'Expected "," between entries',
  CloseBraceExpected: 'Expected "}" to close the object',
  CloseBracketExpected: 'Expected "]" to close the array',
  EndOfFileExpected: 'Unexpected content after the end of the document',
  InvalidCommentToken: 'Comments are not valid JSON',
  UnexpectedEndOfComment: 'Unterminated comment',
  UnexpectedEndOfString: 'Unterminated string',
  UnexpectedEndOfNumber: 'Unterminated number',
  InvalidUnicode: 'Invalid unicode escape',
  InvalidEscapeCharacter: 'Invalid escape character in string',
  InvalidCharacter: 'Invalid character in string',
};

/** Every syntax error in the document (not just the first, unlike JSON.parse). */
export function validateJson(text: string, format: JsonFormat = 'json'): JsonIssue[] {
  const errors: ParseError[] = [];
  parseTree(text, errors, PARSE_OPTIONS[format]);
  return errors.map((error) => {
    const code = printParseErrorCode(error.error);
    return {
      offset: error.offset,
      length: Math.max(error.length, 1),
      message: ERROR_MESSAGES[code] ?? code,
    };
  });
}

/**
 * Pretty-print, preserving key order and raw number tokens. jsonc-parser's
 * formatter only edits the whitespace between tokens, so in JSONC every
 * comment and trailing comma stays where it was.
 */
export function formatJson(text: string, indent = 2): string {
  const edits = format(text, undefined, {
    insertSpaces: true,
    tabSize: indent,
    eol: '\n',
    keepLines: false,
  });
  return applyEdits(text, edits);
}

/**
 * Strip inter-token whitespace, preserving every raw token exactly. JSONC keeps
 * its comments (`minifyJsonc`); strict JSON has none to keep.
 */
export function minifyJson(text: string, format: JsonFormat = 'json'): string {
  if (format === 'jsonc') return minifyJsonc(text);
  const scanner = createScanner(text, /* ignoreTrivia */ true);
  let out = '';
  for (;;) {
    const kind = scanner.scan();
    if (kind === SYNTAX_KIND_EOF) break;
    if (scanner.getTokenError() !== SCAN_ERROR_NONE) return text.trim();
    out += text.slice(
      scanner.getTokenOffset(),
      scanner.getTokenOffset() + scanner.getTokenLength(),
    );
  }
  return out;
}

/**
 * Unwrap a document that is a JSON string containing JSON (e.g. a log field
 * like "{\"a\":1}"): peels string layers while the inner text is itself valid
 * JSON. Returns null when there is nothing to unescape.
 */
export function unescapeEmbedded(text: string): string | null {
  let current = text;
  let unwrapped = false;
  for (;;) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(current);
    } catch {
      break;
    }
    if (typeof parsed !== 'string') break;
    try {
      JSON.parse(parsed);
    } catch {
      break;
    }
    current = parsed;
    unwrapped = true;
  }
  return unwrapped ? current : null;
}

export interface JsonStats {
  bytes: number;
  lines: number;
  /** Value nodes (objects, arrays, strings, numbers, booleans, nulls). */
  nodes: number;
  /** Max nesting depth of value nodes; 0 for an empty/unparseable doc. */
  depth: number;
  valid: boolean;
}

export function jsonStats(text: string, format: JsonFormat = 'json'): JsonStats {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, PARSE_OPTIONS[format]);
  const bytes = new TextEncoder().encode(text).length;
  const lines = text.length === 0 ? 0 : text.split('\n').length;
  if (!tree) return { bytes, lines, nodes: 0, depth: 0, valid: false };

  let nodes = 0;
  let depth = 0;
  const walk = (node: Node, level: number): void => {
    if (node.type === 'property') {
      // children are [keyString, value] — the key is not a value node
      const value = node.children?.[1];
      if (value) walk(value, level);
      return;
    }
    nodes += 1;
    if (level > depth) depth = level;
    for (const child of node.children ?? []) walk(child, level + 1);
  };
  walk(tree, 1);
  return { bytes, lines, nodes, depth, valid: errors.length === 0 };
}

/**
 * Render a jsonc-parser path as dot/bracket notation: ["data","items",3,"price"]
 * → `data.items[3].price`. Root is `$`; keys that aren't identifier-safe are
 * bracketed and quoted.
 */
export function formatJsonPath(path: readonly (string | number)[]): string {
  if (path.length === 0) return '$';
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      out += out === '' ? segment : `.${segment}`;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  return out;
}

/** JSON path of the value at a text offset (for cursor tracking / click-to-copy). */
export function pathAt(text: string, offset: number): string {
  return formatJsonPath(getLocation(text, offset).path);
}

export interface TextRange {
  offset: number;
  length: number;
}

export interface DocRanges {
  /**
   * Text range of the value at a JSON path. When the value is an object
   * property, `withKey` widens the range to include the key — the whole
   * `"price": 9` span. Null when the path does not resolve.
   */
  rangeAt(path: readonly (string | number)[], withKey?: boolean): TextRange | null;
}

/**
 * Parse a document once and resolve many paths against it (Variant maps
 * thousands of diff records onto editor decorations — re-parsing per path
 * would be quadratic in document size).
 */
export function docRanges(text: string, format: JsonFormat = 'json'): DocRanges {
  const tree = parseTree(text, undefined, PARSE_OPTIONS[format]);
  return {
    rangeAt(path, withKey = false) {
      if (!tree) return null;
      const node = findNodeAtLocation(tree, path as (string | number)[]);
      if (!node) return null;
      const target = withKey && node.parent?.type === 'property' ? node.parent : node;
      return { offset: target.offset, length: target.length };
    },
  };
}

/** One-shot convenience over docRanges — fine for single lookups. */
export function rangeAtPath(
  text: string,
  path: readonly (string | number)[],
  withKey = false,
  format: JsonFormat = 'json',
): TextRange | null {
  return docRanges(text, format).rangeAt(path, withKey);
}

/**
 * The document's value, for the readers that need one (Tree view, Copy as JS,
 * Variant's compare). JSONC goes through `toStrictJson` first, so both formats
 * get exactly `JSON.parse`'s semantics — the same numbers, the same handling of
 * duplicate and `__proto__` keys — and the source text is never touched.
 * Undefined when the text is not valid in its format.
 */
export function parseJsonValue(text: string, format: JsonFormat = 'json'): unknown {
  const strict = format === 'jsonc' ? toStrictJson(text) : text;
  if (strict === null) return undefined;
  try {
    return JSON.parse(strict) as unknown;
  } catch {
    // Ordinary control flow: invalid text simply has no value to show.
    return undefined;
  }
}

/**
 * Sort keys A→Z in the document's format. Strict JSON keeps its long-standing
 * parse → sort → `JSON.stringify` path; JSONC uses the comment-safe sort,
 * which answers null when it cannot keep every comment with its member.
 */
export function sortJsonKeys(text: string, format: JsonFormat = 'json'): string | null {
  if (format === 'jsonc') return sortJsoncKeys(text, (sorted) => formatJson(sorted));
  try {
    return JSON.stringify(sortKeysDeep(JSON.parse(text)), null, 2);
  } catch {
    // Ordinary control flow: sorting needs a valid document.
    return null;
  }
}
