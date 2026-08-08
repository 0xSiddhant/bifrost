import { isAlias, isScalar, visit, Scalar, type Document } from 'yaml';
import { lineAt, parseYamlDocuments } from './parse';
import type { YamlAdvisory } from './types';

/**
 * The values YAML 1.1 reads as booleans and YAML 1.2 reads as strings. The
 * "Norway problem": a country list containing `NO` becomes `false` in Ruby,
 * older Python, and several CI runners, while the editor here shows a string.
 */
const NORWAY = /^(y|n|yes|no|on|off|true|false)$/i;

/** Plain decimal that lost digits or precision when the parser read it. */
const VERSION_LIKE = /^[+-]?\d+\.\d/;

/**
 * Warnings about documents that are **valid** and probably mean something other
 * than they look like — YAML's real hazard, and the joke the tool is named for.
 *
 * Every one of these is non-blocking and none of them rewrites a byte: the
 * point is to tell the user what their file will do elsewhere, not to decide
 * for them. `country: no` is flagged and still saves as written.
 */
export function advisories(text: string): YamlAdvisory[] {
  if (text.trim() === '') return [];

  const found: YamlAdvisory[] = [];
  const at = (offset: number) => lineAt(text, offset);
  const push = (advisory: YamlAdvisory) => found.push(advisory);

  for (const doc of parseYamlDocuments(text)) {
    collectFromErrors(doc, at, push);
    collectFromNodes(doc, at, push);
  }

  return found.sort((a, b) => a.offset - b.offset);
}

/**
 * Two of the table's rows are things the library already detects and reports as
 * errors. Duplicate keys are downgraded here (legal YAML that every parser
 * accepts); a tab stays an error in the gutter *and* appears here, because "it
 * is somewhere in your indentation" is the part that is hard to find by eye.
 */
function collectFromErrors(
  doc: Document.Parsed,
  at: (offset: number) => number,
  push: (advisory: YamlAdvisory) => void,
): void {
  for (const error of doc.errors) {
    const [from, to] = error.pos;
    const length = Math.max(1, to - from);
    if (error.code === 'DUPLICATE_KEY') {
      push({
        kind: 'duplicate-key',
        message: 'Duplicate key in this mapping — most parsers keep the last one and say nothing.',
        offset: from,
        length,
        line: error.linePos?.[0]?.line ?? at(from),
      });
    } else if (error.code === 'TAB_AS_INDENT') {
      push({
        kind: 'tab-indent',
        message: 'Tab character used as indentation — the spec forbids it, so this file will not parse.',
        offset: from,
        length,
        line: error.linePos?.[0]?.line ?? at(from),
      });
    }
  }
}

function collectFromNodes(
  doc: Document.Parsed,
  at: (offset: number) => number,
  push: (advisory: YamlAdvisory) => void,
): void {
  const anchors = new Set<string>();

  visit(doc, (_key, node) => {
    if (isAlias(node)) {
      const [from, to] = node.range ?? [0, 0];
      push({
        kind: 'anchor',
        message: `Alias *${node.source} — the tree below expands the anchor, so it appears more than once.`,
        offset: from,
        length: Math.max(1, to - from),
        line: at(from),
      });
      return;
    }
    if (!isScalar(node)) {
      if (node && typeof node === 'object' && 'anchor' in node && node.anchor) {
        anchors.add(String(node.anchor));
      }
      return;
    }
    if (node.anchor) anchors.add(node.anchor);

    // Only *unquoted* scalars are ambiguous. `"no"` is a string everywhere, and
    // flagging it would train the user to ignore the rail.
    if (node.type !== Scalar.PLAIN) return;
    const source = node.source ?? '';
    const [from, to] = node.range ?? [0, 0];
    const length = Math.max(1, to - from);
    const line = at(from);
    const value = node.value;

    if (NORWAY.test(source) && typeof value === 'string') {
      push({
        kind: 'norway',
        message: `Unquoted "${source}" reads as text here (YAML 1.2) and as a boolean in any YAML 1.1 reader — quote it to be sure.`,
        offset: from,
        length,
        line,
      });
      return;
    }

    if (typeof value !== 'number') return;

    if (VERSION_LIKE.test(source) && String(value) !== source) {
      push({
        kind: 'version-like',
        message: `${source} is being read as the number ${value} — quote it if it is a version.`,
        offset: from,
        length,
        line,
      });
      return;
    }

    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      push({
        kind: 'unsafe-integer',
        message: `${source} is past the safe integer range and was read as ${value} — quote it to keep every digit.`,
        offset: from,
        length,
        line,
      });
    }
  });

  if (anchors.size > 0) {
    // One informational line naming what is defined, so an expanded tree is not
    // a surprise. Positioned at the top of the document deliberately: it is
    // about the document, not about one place in it.
    push({
      kind: 'anchor',
      message: `Anchors defined: ${[...anchors].map((name) => `&${name}`).join(', ')}.`,
      offset: 0,
      length: 1,
      line: 1,
    });
  }
}
