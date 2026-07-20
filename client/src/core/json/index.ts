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
 */

/** Strict-JSON parse options: comments and trailing commas are errors here. */
const STRICT = { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false };

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
export function validateJson(text: string): JsonIssue[] {
  const errors: ParseError[] = [];
  parseTree(text, errors, STRICT);
  return errors.map((error) => {
    const code = printParseErrorCode(error.error);
    return {
      offset: error.offset,
      length: Math.max(error.length, 1),
      message: ERROR_MESSAGES[code] ?? code,
    };
  });
}

/** Pretty-print, preserving key order and raw number tokens. */
export function formatJson(text: string, indent = 2): string {
  const edits = format(text, undefined, {
    insertSpaces: true,
    tabSize: indent,
    eol: '\n',
    keepLines: false,
  });
  return applyEdits(text, edits);
}

/** Strip inter-token whitespace, preserving every raw token exactly. */
export function minifyJson(text: string): string {
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
 * Recursively sort object keys A→Z (code-unit order — deterministic and
 * idempotent; property-tested). Arrays keep their element order. Shared with
 * PLAN-08: sorting both sides before diffing kills key-ordering noise.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, child]) => [key, sortKeysDeep(child)]));
  }
  return value;
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

export function jsonStats(text: string): JsonStats {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, STRICT);
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

/**
 * Text range of the value at a JSON path (Variant maps diff records onto
 * editor decorations with this). When the value is an object property,
 * `withKey` widens the range to include the key — the whole `"price": 9` span.
 * Null when the document is unparseable or the path does not resolve.
 */
export function rangeAtPath(
  text: string,
  path: readonly (string | number)[],
  withKey = false,
): TextRange | null {
  const tree = parseTree(text, undefined, STRICT);
  if (!tree) return null;
  const node = findNodeAtLocation(tree, path as (string | number)[]);
  if (!node) return null;
  const target = withKey && node.parent?.type === 'property' ? node.parent : node;
  return { offset: target.offset, length: target.length };
}
