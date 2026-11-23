import { createScanner, parseTree, type Node, type ParseError } from 'jsonc-parser';
import { sortKeysDeep } from './sortKeys';

/**
 * JSONC (PLAN-42): JSON plus `//` and `/* *\/` comments and trailing commas in
 * objects and arrays — and nothing else. Unquoted keys, single quotes, `NaN`,
 * hex numbers and the rest of JSON5 stay errors.
 *
 * Every transform here works on the **source tokens**, never on a parsed value,
 * so a comment is never dropped by accident and a raw number such as
 * `9007199254740993` or `1.50` survives byte for byte. Each one checks its own
 * output and answers `null` rather than return something it cannot vouch for.
 */

/** The two document formats a Runestone can be in. */
export type JsonFormat = 'json' | 'jsonc';

export const JSON_FORMATS: readonly JsonFormat[] = ['json', 'jsonc'];

/** The file extension and media type each format imports and exports as. */
export const FORMAT_FILE: Record<
  JsonFormat,
  { extension: string; mimeType: string; label: string }
> = {
  json: { extension: '.json', mimeType: 'application/json', label: 'JSON' },
  jsonc: { extension: '.jsonc', mimeType: 'application/jsonc', label: 'JSONC' },
};

/** A stored or requested format, read defensively: anything unknown is JSON. */
export function asJsonFormat(value: unknown): JsonFormat {
  return value === 'jsonc' ? 'jsonc' : 'json';
}

/** jsonc-parser's options for each format. Strict JSON: comments and trailing commas are errors. */
export const PARSE_OPTIONS: Record<
  JsonFormat,
  { disallowComments: boolean; allowTrailingComma: boolean; allowEmptyContent: boolean }
> = {
  json: { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false },
  jsonc: { disallowComments: false, allowTrailingComma: true, allowEmptyContent: false },
};

// jsonc-parser publishes SyntaxKind/ScanError as ambient const enums, which
// isolatedModules cannot import — these are their published numeric values.
const CLOSE_BRACE = 2;
const CLOSE_BRACKET = 4;
const COMMA = 5;
const COLON = 6;
const NULL_KEYWORD = 7;
const TRUE_KEYWORD = 8;
const FALSE_KEYWORD = 9;
const STRING = 10;
const NUMBER = 11;
const LINE_COMMENT = 12;
const BLOCK_COMMENT = 13;
const LINE_BREAK = 14;
const WHITESPACE = 15;
const EOF = 17;
const SCAN_ERROR_NONE = 0;

interface Token {
  kind: number;
  start: number;
  end: number;
}

const isComment = (kind: number): boolean => kind === LINE_COMMENT || kind === BLOCK_COMMENT;
const isTrivia = (kind: number): boolean =>
  kind === WHITESPACE || kind === LINE_BREAK || isComment(kind);
const isValueToken = (kind: number): boolean =>
  kind === STRING ||
  kind === NUMBER ||
  kind === TRUE_KEYWORD ||
  kind === FALSE_KEYWORD ||
  kind === NULL_KEYWORD;

/** Every token, trivia included; null when the scanner hits a broken token. */
function scanTokens(text: string): Token[] | null {
  const scanner = createScanner(text, /* ignoreTrivia */ false);
  const tokens: Token[] = [];
  for (;;) {
    const kind = scanner.scan();
    if (kind === EOF) return tokens;
    if (scanner.getTokenError() !== SCAN_ERROR_NONE) return null;
    const start = scanner.getTokenOffset();
    tokens.push({ kind, start, end: start + scanner.getTokenLength() });
  }
}

function hasErrors(text: string, format: JsonFormat): boolean {
  const errors: ParseError[] = [];
  parseTree(text, errors, PARSE_OPTIONS[format]);
  return errors.length > 0;
}

/**
 * Valid JSONC → the same document as strict JSON: comments and trailing commas
 * removed, every other byte kept (so raw numbers and string escapes are exactly
 * as written). A line left holding nothing but a removed comment is removed
 * with it. This is a **copy**, never applied to the editor buffer.
 *
 * Null when the input is not valid JSONC, or when the result would not be
 * valid strict JSON — the caller says so rather than ship a lossy conversion.
 */
export function toStrictJson(text: string): string | null {
  if (text.trim() === '' || hasErrors(text, 'jsonc')) return null;
  const tokens = scanTokens(text);
  if (!tokens) return null;
  const drop = new Array<boolean>(tokens.length).fill(false);

  const nextSignificant = (from: number): Token | undefined => {
    for (let i = from; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token && !isTrivia(token.kind)) return token;
    }
    return undefined;
  };

  tokens.forEach((token, index) => {
    if (isComment(token.kind)) drop[index] = true;
    if (token.kind !== COMMA) return;
    const next = nextSignificant(index + 1);
    if (next && (next.kind === CLOSE_BRACE || next.kind === CLOSE_BRACKET)) drop[index] = true;
  });

  // Then the whitespace the removals leave behind, one line at a time (a line
  // is the tokens up to and including its line break), so comments that share
  // a line are judged together:
  // - a line whose only content was removed goes, line break and all;
  // - two runs of whitespace left side by side keep the first (the indent);
  // - whitespace that touched a removed token goes at the end of the line or
  //   before `,` `:` `]` `}` — `1 /* x */,` becomes `1,`, not `1 ,`.
  const closesTight = (kind: number | undefined): boolean =>
    kind === COMMA || kind === COLON || kind === CLOSE_BRACE || kind === CLOSE_BRACKET;
  let lineStart = 0;
  while (lineStart < tokens.length) {
    let lineEnd = lineStart;
    while (lineEnd < tokens.length && tokens[lineEnd]?.kind !== LINE_BREAK) lineEnd += 1;
    // [lineStart, lineEnd) is the line's tokens; lineEnd is its line break, if any.
    const line: number[] = [];
    for (let i = lineStart; i < lineEnd; i += 1) line.push(i);
    const content = line.filter((i) => tokens[i]?.kind !== WHITESPACE);
    const removed = content.filter((i) => drop[i]);
    if (removed.length > 0 && removed.length === content.length) {
      for (const i of line) drop[i] = true;
      if (lineEnd < tokens.length) drop[lineEnd] = true;
    } else if (removed.length > 0) {
      const kept = line.filter((i) => !drop[i]);
      const touched = (i: number): boolean => Boolean(drop[i - 1] || drop[i + 1]);
      kept.forEach((i, at) => {
        if (tokens[i]?.kind !== WHITESPACE || !touched(i)) return;
        const previous = kept[at - 1];
        // The next thing left on the line that is not itself whitespace.
        const next = kept.slice(at + 1).find((j) => tokens[j]?.kind !== WHITESPACE);
        if (
          (previous !== undefined && tokens[previous]?.kind === WHITESPACE && !drop[previous]) ||
          next === undefined ||
          closesTight(tokens[next]?.kind)
        ) {
          drop[i] = true;
        }
      });
    }
    lineStart = lineEnd + 1;
  }

  let out = '';
  tokens.forEach((token, index) => {
    if (!drop[index]) out += text.slice(token.start, token.end);
  });
  return hasErrors(out, 'json') ? null : out;
}

/**
 * Minify JSONC: whitespace goes, comments stay. A line comment runs to the end
 * of its line, so a newline is kept after one whenever anything follows it —
 * otherwise it would swallow the next token.
 */
export function minifyJsonc(text: string): string {
  const tokens = scanTokens(text);
  if (!tokens) return text.trim();
  let out = '';
  let needsBreak = false;
  for (const token of tokens) {
    if (token.kind === WHITESPACE || token.kind === LINE_BREAK) continue;
    if (needsBreak) out += '\n';
    out += text.slice(token.start, token.end);
    needsBreak = token.kind === LINE_COMMENT;
  }
  return out;
}

interface CommentPiece {
  text: string;
  /** A line break followed it in the source (always true for a line comment). */
  breakAfter: boolean;
}

/** Renders one comment and the separator it needs after it. */
function renderComment(comment: CommentPiece): string {
  return `${comment.text}${comment.breakAfter ? '\n' : ' '}`;
}

/** An array-index key ("0", "9", "10"): a JS object lists these first, by number. */
function isIndexKey(key: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 4294967295;
}

/**
 * The key order strict JSON's Sort keys produces: `JSON.stringify` over an
 * object built by `sortKeysDeep`, where JavaScript puts array-index keys first
 * in numeric order and the rest in code-unit order. JSONC's sort uses the same
 * order, so a strict side and a JSONC side of one document sort alike.
 */
function compareKeys(a: string, b: string): number {
  const aIndex = isIndexKey(a);
  const bIndex = isIndexKey(b);
  if (aIndex && bIndex) return Number(a) - Number(b);
  if (aIndex !== bIndex) return aIndex ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort every object's keys A→Z (the order strict JSON's Sort keys gives, see
 * `compareKeys`)
 * while keeping each comment with the member it belongs to:
 *
 * - a comment between a member's value and its comma, or after the comma on
 *   the same line, trails that member and moves with it;
 * - any other comment before a member leads it and moves with it;
 * - a comment on the line of the opening `{` stays at the top of the object,
 *   and one after the last member's line stays at the bottom.
 *
 * Arrays keep their order and every byte between their elements. Raw value
 * tokens are copied, never re-serialized. The result is then formatted, like
 * Sort keys' strict-JSON output.
 *
 * The result is checked before it is returned — the same value as a sorted
 * parse, the same multiset of comments, the same multiset of raw tokens — and
 * the answer is null if any check fails, so a document this cannot sort safely
 * is refused, never mangled.
 */
export function sortJsoncKeys(text: string, format: (text: string) => string): string | null {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, PARSE_OPTIONS.jsonc);
  if (!root || errors.length > 0) return null;
  const tokens = scanTokens(text);
  if (!tokens) return null;

  /** Index of the first token starting at or after `offset`. */
  const firstTokenAt = (offset: number): number => {
    let low = 0;
    let high = tokens.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const token = tokens[mid];
      if (token && token.start < offset) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  /** The tokens wholly inside [from, to). */
  const tokensIn = (from: number, to: number): Token[] => {
    const found: Token[] = [];
    for (let i = firstTokenAt(from); i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token || token.start >= to) break;
      found.push(token);
    }
    return found;
  };

  const hasBreakBetween = (from: number, to: number): boolean =>
    /[\r\n]/.test(text.slice(from, to));

  /** A comment, with whether a line break followed it before the next token. */
  const pieceFor = (token: Token): CommentPiece => {
    if (token.kind === LINE_COMMENT) {
      return { text: text.slice(token.start, token.end), breakAfter: true };
    }
    // Whitespace and line breaks are tokens of their own; look past them.
    let breakAfter = false;
    for (let i = firstTokenAt(token.end); i < tokens.length && !breakAfter; i += 1) {
      const following = tokens[i];
      if (!following) break;
      if (following.kind === LINE_BREAK) breakAfter = true;
      else if (following.kind !== WHITESPACE) break;
    }
    return { text: text.slice(token.start, token.end), breakAfter };
  };

  const render = (node: Node): string => {
    if (node.type === 'object') return renderObject(node);
    if (node.type === 'array') return renderArray(node);
    return text.slice(node.offset, node.offset + node.length);
  };

  const renderArray = (node: Node): string => {
    const end = node.offset + node.length;
    const children = node.children ?? [];
    let out = '';
    let cursor = node.offset;
    for (const child of children) {
      out += text.slice(cursor, child.offset) + render(child);
      cursor = child.offset + child.length;
    }
    return out + text.slice(cursor, end);
  };

  interface Member {
    key: string;
    leading: CommentPiece[];
    body: string;
    /** Comments between the value and the comma. */
    inline: CommentPiece[];
    /** Comments after the comma, on its line. */
    trailing: CommentPiece[];
  }

  const renderObject = (node: Node): string => {
    const end = node.offset + node.length;
    const properties = node.children ?? [];
    const head: CommentPiece[] = [];
    const tail: CommentPiece[] = [];
    const members: Member[] = [];
    let trailingComma = false;

    properties.forEach((property) => {
      const [keyNode, valueNode] = property.children ?? [];
      if (!keyNode || !valueNode) return;
      members.push({
        key: String(keyNode.value),
        leading: [],
        // The key, anything between it and the value (the colon, comments), the value.
        body: text.slice(keyNode.offset, valueNode.offset) + render(valueNode),
        inline: [],
        trailing: [],
      });
    });
    if (members.length !== properties.length) throw new Error('unexpected property shape');

    // The gaps: before the first member, between members, after the last.
    // Valid JSONC has exactly one comma between two members and at most one
    // (a trailing comma) after the last, so each gap is read around its comma.
    for (let gap = 0; gap <= properties.length; gap += 1) {
      const previous = properties[gap - 1];
      const next = properties[gap];
      const from = previous ? previous.offset + previous.length : node.offset + 1;
      const to = next ? next.offset : end - 1;
      const owner = members[gap - 1];
      const following = members[gap];
      const gapTokens = tokensIn(from, to);
      const comma = gapTokens.find((token) => token.kind === COMMA);
      if (owner && !next && comma) trailingComma = true;
      for (const token of gapTokens) {
        if (!isComment(token.kind)) continue;
        const piece = pieceFor(token);
        if (!owner) {
          // Before the first member: on the brace's own line it is the object's.
          if (!hasBreakBetween(from, token.start)) head.push(piece);
          else if (following) following.leading.push(piece);
          else tail.push(piece);
        } else if (comma && token.start < comma.start) {
          owner.inline.push(piece);
        } else if (comma) {
          if (!hasBreakBetween(comma.end, token.start)) owner.trailing.push(piece);
          else if (following) following.leading.push(piece);
          else tail.push(piece);
        } else if (!hasBreakBetween(from, token.start)) {
          // After the last member, with no trailing comma: on its line it trails it.
          owner.trailing.push(piece);
        } else {
          tail.push(piece);
        }
      }
    }

    const sorted = members
      .map((member, index) => ({ member, index }))
      .sort((a, b) => compareKeys(a.member.key, b.member.key) || a.index - b.index)
      .map(({ member }) => member);

    let out = '{';
    // A line comment already ends its line; never add a blank one after it.
    const newline = () => {
      if (!out.endsWith('\n')) out += '\n';
    };
    // A comment beside a token gets a space before it, unless it opens a line.
    const beside = (comment: CommentPiece) => {
      out += `${out.endsWith('\n') ? '' : ' '}${renderComment(comment)}`;
    };
    for (const comment of head) beside(comment);
    sorted.forEach((member, index) => {
      newline();
      for (const comment of member.leading) out += renderComment(comment);
      out += member.body;
      for (const comment of member.inline) beside(comment);
      if (index < sorted.length - 1 || trailingComma) out += ',';
      for (const comment of member.trailing) beside(comment);
    });
    if (tail.length > 0 || sorted.length > 0) newline();
    for (const comment of tail) out += renderComment(comment);
    return `${out}}`;
  };

  let sortedText: string;
  try {
    const before = text.slice(0, root.offset);
    const after = text.slice(root.offset + root.length);
    sortedText = format(before + render(root) + after);
  } catch {
    // A tree shape this walk does not expect: refused below, never guessed at.
    return null;
  }
  return sortedIsFaithful(text, sortedText) ? sortedText : null;
}

/** The three properties a comment-safe sort must keep, checked on the output. */
function sortedIsFaithful(original: string, sorted: string): boolean {
  if (hasErrors(sorted, 'jsonc')) return false;
  const before = scanTokens(original);
  const after = scanTokens(sorted);
  if (!before || !after) return false;
  const pick = (tokens: Token[], text: string, keep: (kind: number) => boolean): string[] =>
    tokens
      .filter((token) => keep(token.kind))
      .map((token) => text.slice(token.start, token.end).trimEnd())
      .sort();
  const same = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  if (!same(pick(before, original, isComment), pick(after, sorted, isComment))) return false;
  if (!same(pick(before, original, isValueToken), pick(after, sorted, isValueToken))) return false;
  const strictBefore = toStrictJson(original);
  const strictAfter = toStrictJson(sorted);
  if (strictBefore === null || strictAfter === null) return false;
  if (
    JSON.stringify(sortKeysDeep(JSON.parse(strictBefore))) !==
    JSON.stringify(JSON.parse(strictAfter))
  ) {
    return false;
  }
  // JSON.parse puts index keys first whatever the text says, so the value check
  // cannot see the order the keys are written in: read it from the text itself.
  return keysWrittenInOrder(sorted);
}

/** Every object's keys, as written, are in `compareKeys` order. */
function keysWrittenInOrder(text: string): boolean {
  const root = parseTree(text, undefined, PARSE_OPTIONS.jsonc);
  if (!root) return false;
  const walk = (node: Node): boolean => {
    const children = node.children ?? [];
    if (node.type === 'object') {
      const keys = children.map((property) => String(property.children?.[0]?.value));
      for (let i = 1; i < keys.length; i += 1) {
        if (compareKeys(keys[i - 1] ?? '', keys[i] ?? '') > 0) return false;
      }
      return children.every((property) => {
        const value = property.children?.[1];
        return value === undefined || walk(value);
      });
    }
    return children.every(walk);
  };
  return walk(root);
}
