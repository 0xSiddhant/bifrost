import { isAlias, isMap, isScalar, isSeq, Scalar, type Document, type Range } from 'yaml';

/**
 * YAML's traps are mostly **valid** documents that mean something other than
 * they look like — which is the joke the tool's name is built on. None of these
 * block a save and none of them rewrite a byte; they say what a different reader
 * will see. Auto-"fixing" them would be the actual bug: quoting `no` changes the
 * document for the consumer who wanted a boolean.
 */

export type YamlAdvisoryKind =
  | 'boolish'
  | 'duplicate-key'
  | 'tab-indent'
  | 'lossy-number'
  | 'unsafe-integer'
  | 'anchor'
  | 'merge-key'
  | 'parser-warning';

export interface YamlAdvisory {
  kind: YamlAdvisoryKind;
  /** Source offset of the value being advised about — the rail jumps here. */
  offset: number;
  length: number;
  /** 1-based line, so the rail can say "line 12" without re-scanning. */
  line: number;
  message: string;
}

/**
 * Plain scalars that are strings under YAML 1.2 and **booleans** under YAML 1.1
 * — Ruby's psych, PyYAML, and a good number of CI runners. `NO` is the ISO
 * country code for Norway, which is how this became "the Norway problem".
 * `true`/`false` are absent on purpose: they are booleans in both versions.
 */
const BOOLISH = new Set([
  'y',
  'Y',
  'n',
  'N',
  'yes',
  'Yes',
  'YES',
  'no',
  'No',
  'NO',
  'on',
  'On',
  'ON',
  'off',
  'Off',
  'OFF',
]);

function lineAt(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * A tab used for indentation is a hard error in the spec, and the parser's own
 * message points at the token that failed rather than the invisible character
 * that caused it. Found by scanning the text because a document this broken may
 * not produce a tree at all.
 */
export function tabIndentAdvisories(text: string): YamlAdvisory[] {
  const out: YamlAdvisory[] = [];
  let offset = 0;
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
    const tab = leading.indexOf('\t');
    if (tab !== -1) {
      out.push({
        kind: 'tab-indent',
        offset: offset + tab,
        length: 1,
        line: index + 1,
        message:
          'Indented with a tab. YAML forbids tabs in indentation — replace it with spaces.',
      });
    }
    offset += line.length + 1;
  }
  return out;
}

/** The source text a parsed node came from — its own bytes, never a re-render. */
function sourceOf(text: string, range: Range | null | undefined): string {
  return range ? text.slice(range[0], range[1]) : '';
}

function isPlain(node: Scalar): boolean {
  // Parsed scalars carry the style they were written in; only an unquoted
  // (plain) scalar is subject to implicit typing.
  return node.type === Scalar.PLAIN || node.type === undefined;
}

function scalarAdvisory(
  node: Scalar,
  text: string,
  position: 'key' | 'value',
): YamlAdvisory | null {
  if (!isPlain(node)) return null;
  const offset = node.range?.[0] ?? 0;
  const source = sourceOf(text, node.range);
  if (source === '') return null;
  const line = lineAt(text, offset);
  const base = { offset, length: source.length, line };

  if (typeof node.value === 'string' && BOOLISH.has(source)) {
    return {
      ...base,
      kind: 'boolish',
      message:
        position === 'key'
          ? `The key \`${source}\` is the string "${source}" here, and \`${/^(y|yes|on)$/i.test(source) ? 'true' : 'false'}\` to any YAML 1.1 reader. Quote it to pin it down.`
          : `\`${source}\` is the string "${source}" here, and \`${/^(y|yes|on)$/i.test(source) ? 'true' : 'false'}\` to any YAML 1.1 reader (Ruby, older Python, some CI). Quote it to pin it down.`,
    };
  }

  if (typeof node.value !== 'number' || !Number.isFinite(node.value)) return null;
  // Hex and octal literals are written deliberately; re-rendering them in
  // decimal is not a surprise worth a warning.
  if (/^[-+]?0[xob]/i.test(source)) return null;

  if (Number.isInteger(node.value) && !Number.isSafeInteger(node.value)) {
    return {
      ...base,
      kind: 'unsafe-integer',
      message: `\`${source}\` is past the safe integer range — it reads back as ${node.value}, losing digits. Quote it to keep it exact.`,
    };
  }

  if (String(node.value) !== source) {
    return {
      ...base,
      kind: 'lossy-number',
      message: `\`${source}\` is the number ${node.value}, not the text "${source}". Quote it if the exact characters matter (versions usually do).`,
    };
  }

  return null;
}

interface Walked {
  advisories: YamlAdvisory[];
  /** Anchor name → its declaration offset and how many aliases use it. */
  anchors: Map<string, { offset: number; uses: number }>;
}

function walk(node: unknown, text: string, out: Walked): void {
  if (node === null || node === undefined) return;

  if (isScalar(node)) {
    const advisory = scalarAdvisory(node, text, 'value');
    if (advisory) out.advisories.push(advisory);
    return;
  }

  if (isMap(node)) {
    const seen = new Map<string, number>();
    for (const pair of node.items) {
      const key = pair.key;
      if (isScalar(key)) {
        const keyAdvisory = scalarAdvisory(key, text, 'key');
        if (keyAdvisory) out.advisories.push(keyAdvisory);

        const source = sourceOf(text, key.range);
        const offset = key.range?.[0] ?? 0;

        if (source === '<<') {
          out.advisories.push({
            kind: 'merge-key',
            offset,
            length: 2,
            line: lineAt(text, offset),
            message:
              '`<<` merges the aliased mapping in here, as Docker Compose and most CI runners do. A strict YAML 1.2 reader treats it as an ordinary key named "<<".',
          });
        } else if (typeof key.value === 'string' || typeof key.value === 'number') {
          const label = String(key.value);
          const first = seen.get(label);
          if (first !== undefined) {
            out.advisories.push({
              kind: 'duplicate-key',
              offset,
              length: Math.max(source.length, 1),
              line: lineAt(text, offset),
              message: `\`${label}\` is set twice in this mapping (first on line ${lineAt(text, first)}). The last one silently wins.`,
            });
          } else {
            seen.set(label, offset);
          }
        }
      }
      walk(pair.value, text, out);
    }
    return;
  }

  if (isSeq(node)) {
    for (const item of node.items) walk(item, text, out);
  }
}

/** Anchors and aliases are informational: they explain an expanded tree view. */
function anchorAdvisories(node: unknown, text: string, out: Walked): void {
  if (node === null || node === undefined) return;
  if (isAlias(node)) {
    const existing = out.anchors.get(node.source);
    if (existing) existing.uses += 1;
    return;
  }
  if (isScalar(node) || isMap(node) || isSeq(node)) {
    const anchor = node.anchor;
    if (anchor && !out.anchors.has(anchor)) {
      out.anchors.set(anchor, { offset: node.range?.[0] ?? 0, uses: 0 });
    }
  }
  if (isMap(node)) {
    for (const pair of node.items) anchorAdvisories(pair.value, text, out);
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) anchorAdvisories(item, text, out);
  }
}

/** Every advisory the parsed stream carries, unsorted (the caller merges them). */
export function advisoriesFor(docs: readonly Document.Parsed[], text: string): YamlAdvisory[] {
  const out: Walked = { advisories: [], anchors: new Map() };
  for (const doc of docs) {
    // A document that failed to parse has a partial tree; advising from it
    // produces confident nonsense about nodes the author never wrote.
    if (doc.errors.length > 0) continue;
    // The parser's own warnings — an unresolvable tag, a version it does not
    // implement — mean a value quietly became something else. They are not
    // errors and the library only exposes them here, so they belong on the rail
    // rather than nowhere.
    for (const warning of doc.warnings) {
      out.advisories.push({
        kind: 'parser-warning',
        offset: warning.pos[0],
        length: Math.max(warning.pos[1] - warning.pos[0], 1),
        line: lineAt(text, warning.pos[0]),
        message: warning.message,
      });
    }
    walk(doc.contents, text, out);
    anchorAdvisories(doc.contents, text, out);
  }
  for (const [name, { offset, uses }] of out.anchors) {
    out.advisories.push({
      kind: 'anchor',
      offset,
      length: name.length + 1,
      line: lineAt(text, offset),
      message:
        uses === 0
          ? `\`&${name}\` is declared but never referenced.`
          : `\`&${name}\` is referenced by ${uses} ${uses === 1 ? 'alias' : 'aliases'} — the tree shows them expanded.`,
    });
  }
  return out.advisories;
}
