import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  stringify,
  type Document,
  type DocumentOptions,
  type ParseOptions,
  type SchemaOptions,
  type ToJSOptions,
} from 'yaml';
import { formatJsonPath } from '../json';
import { advisoriesFor, tabIndentAdvisories, type YamlAdvisory } from './advisories';

/**
 * Pure YAML document utilities (PLAN-19). The Groot editor uses all of these;
 * they are named for the **format**, not the tool, because a second YAML
 * consumer (Variant's YAML mode) may not import a feature.
 *
 * Built on `yaml` (eemeli) v2 rather than `js-yaml` for one decisive reason: it
 * keeps a comment-preserving document model, so `formatYaml` re-indents a
 * config file without deleting the comments that explain it. A naive
 * parse + stringify would be silent data loss.
 */

export type { YamlAdvisory, YamlAdvisoryKind } from './advisories';

/**
 * Alias expansion is a billion-laughs amplifier: a 3 KB document can expand to
 * gigabytes, so a byte cap does not bound it. `yaml` counts alias resolutions
 * and throws past this; it is named (rather than left to the library default)
 * because it is the guard, and a test asserts a bomb hits it.
 */
export const MAX_ALIAS_COUNT = 100;

const PARSE_OPTIONS: ParseOptions & DocumentOptions & SchemaOptions = {
  // A duplicate key is an advisory here, not a blocking error — the document is
  // valid YAML and every parser accepts it, it just means something the author
  // probably did not intend. Leaving it as an error would refuse the save.
  uniqueKeys: false,
  // YAML 1.2 core schema: `no` is the string "no", not `false`. Correct here and
  // wrong on a 1.1 consumer's machine, which is what the `boolish` advisory is
  // for. A document's own `%YAML 1.1` directive still overrides this.
  version: '1.2',
  // `<<` merge keys are a 1.1 extension that Docker Compose, GitLab CI and most
  // of the real world rely on, so resolving them is what makes the tree view
  // match what the reader's tool will do. The `merge-key` advisory says so out
  // loud, because a strict 1.2 reader treats `<<` as an ordinary key.
  merge: true,
  // Keep the library's message; the line/column comes from the offset instead,
  // so it is a real editor position rather than text inside a sentence.
  prettyErrors: false,
};

const TO_JS_OPTIONS: ToJSOptions = { maxAliasCount: MAX_ALIAS_COUNT };

/** Byte-offset issue, the shape `core/json` already uses so the lint gutter is shared. */
export interface YamlIssue {
  offset: number;
  length: number;
  message: string;
}

export interface AnchorUse {
  /** The anchor name, without the `&`. */
  name: string;
  /** How many aliases point at it. */
  uses: number;
  offset: number;
}

/** One document of a `---`-separated stream. */
export interface YamlDocument {
  /** 0-based position in the stream. */
  index: number;
  /** The materialised JS value; `undefined` when it could not be resolved. */
  value: unknown;
  /** Parse errors plus anything thrown while resolving this document. */
  issues: YamlIssue[];
  /** Anchors declared in this document, in source order. */
  anchors: AnchorUse[];
  /** `formatJsonPath` path → the anchor an alias at that path points at. */
  aliasPaths: Map<string, string>;
}

export interface YamlStats {
  bytes: number;
  lines: number;
  /** How many `---`-separated documents the stream holds. */
  documents: number;
  valid: boolean;
}

export interface YamlAnalysis {
  documents: YamlDocument[];
  issues: YamlIssue[];
  advisories: YamlAdvisory[];
  stats: YamlStats;
}

type ParsedDoc = Document.Parsed;

/** `parseAllDocuments` returns an `EmptyStream` marker object for empty input. */
function parseStream(text: string): ParsedDoc[] {
  const docs = parseAllDocuments(text, PARSE_OPTIONS);
  return 'empty' in docs ? [] : docs;
}

function issueOf(error: { pos: [number, number]; message: string }): YamlIssue {
  const [from, to] = error.pos;
  return { offset: from, length: Math.max(to - from, 1), message: error.message };
}

/**
 * Resolving is where a YAML bomb detonates — `maxAliasCount` is enforced during
 * alias expansion, not during the parse — so this is the one call that has to be
 * guarded. The failure is reported against the document's own range, so the
 * editor can point at it rather than at offset 0.
 */
function resolve(doc: ParsedDoc): { value: unknown; issue: YamlIssue | null } {
  try {
    return { value: doc.toJS(TO_JS_OPTIONS), issue: null };
  } catch (error) {
    const at = doc.contents?.range?.[0] ?? 0;
    return {
      value: undefined,
      issue: {
        offset: at,
        length: 1,
        message:
          error instanceof Error
            ? error.message
            : 'This document could not be resolved to a value.',
      },
    };
  }
}

function scalarKey(key: unknown): string | number {
  if (isScalar(key)) return typeof key.value === 'string' ? key.value : String(key.value);
  return String(key);
}

/**
 * Walks the node tree collecting anchors and the paths aliases sit at. The tree
 * view renders **resolved** values (that is what every YAML consumer sees), so
 * without this an aliased subtree would look like an ordinary copy of another
 * one; the path map is what lets the tree badge it `*base`.
 */
function collectRefs(
  node: unknown,
  path: (string | number)[],
  anchors: Map<string, AnchorUse>,
  aliasPaths: Map<string, string>,
): void {
  if (node === null || node === undefined) return;
  if (isAlias(node)) {
    aliasPaths.set(formatJsonPath(path), node.source);
    const existing = anchors.get(node.source);
    if (existing) existing.uses += 1;
    return;
  }
  if (isScalar(node) || isMap(node) || isSeq(node)) {
    const anchor = node.anchor;
    if (anchor && !anchors.has(anchor)) {
      anchors.set(anchor, { name: anchor, uses: 0, offset: node.range?.[0] ?? 0 });
    }
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      collectRefs(pair.value, [...path, scalarKey(pair.key)], anchors, aliasPaths);
    }
    return;
  }
  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      collectRefs(item, [...path, index], anchors, aliasPaths);
    });
  }
}

/**
 * One parse, everything derived from it: documents, blocking issues, advisories
 * and stats. The Groot page calls this once per debounce tick rather than
 * parsing a 2 MB document four times over.
 */
export function analyzeYaml(text: string): YamlAnalysis {
  const bytes = new TextEncoder().encode(text).length;
  const lines = text.length === 0 ? 0 : text.split('\n').length;

  if (text.trim() === '') {
    return {
      documents: [],
      issues: [],
      advisories: [],
      stats: { bytes, lines, documents: 0, valid: false },
    };
  }

  const parsed = parseStream(text);
  const documents: YamlDocument[] = [];
  const issues: YamlIssue[] = [];

  for (const [index, doc] of parsed.entries()) {
    const docIssues = doc.errors.map(issueOf);
    const anchors = new Map<string, AnchorUse>();
    const aliasPaths = new Map<string, string>();
    collectRefs(doc.contents, [], anchors, aliasPaths);

    // A document that already failed to parse is not resolved: `toJS` on a
    // half-built tree reports the same problem a second time in worse words.
    const resolved =
      docIssues.length > 0 ? { value: undefined, issue: null } : resolve(doc);
    if (resolved.issue) docIssues.push(resolved.issue);

    documents.push({
      index,
      value: resolved.value,
      issues: docIssues,
      anchors: [...anchors.values()].sort((a, b) => a.offset - b.offset),
      aliasPaths,
    });
    issues.push(...docIssues);
  }

  issues.sort((a, b) => a.offset - b.offset);

  // Tabs are found by scanning the text, not the tree: a tab in indentation is
  // a hard syntax error, so by the time it matters there may be no tree left.
  const advisories = [...tabIndentAdvisories(text), ...advisoriesFor(parsed, text)].sort(
    (a, b) => a.offset - b.offset,
  );

  return {
    documents,
    issues,
    advisories,
    stats: { bytes, lines, documents: parsed.length, valid: issues.length === 0 },
  };
}

/** Every blocking problem in the stream, in source order (feeds the lint gutter). */
export function validateYaml(text: string): YamlIssue[] {
  return analyzeYaml(text).issues;
}

/** Non-blocking warnings about documents that are valid but ambiguous. */
export function advisories(text: string): YamlAdvisory[] {
  return analyzeYaml(text).advisories;
}

/** The stream's documents with their resolved values, anchors and alias paths. */
export function parseDocuments(text: string): YamlDocument[] {
  return analyzeYaml(text).documents;
}

export function yamlStats(text: string): YamlStats {
  return analyzeYaml(text).stats;
}

/**
 * Re-indent and normalise the stream **without losing a comment** — head,
 * key-level and trailing alike survive, because the document model carries them
 * and `toString` writes them back. A broken document is returned untouched:
 * reformatting what could not be parsed would silently delete the part the
 * parser gave up on.
 *
 * `lineWidth: 0` disables folding, so a long value is never re-wrapped into
 * something that reads as a different string.
 */
export function formatYaml(text: string, indent = 2): string {
  return restyle(text, { indent, lineWidth: 0 });
}

/** Block style everywhere — YAML's "beautify". */
export function toBlock(text: string, indent = 2): string {
  return restyle(text, { indent, lineWidth: 0, collectionStyle: 'block' });
}

/** Flow style everywhere (`{a: 1}`) — YAML's analogue of minify. */
export function toFlow(text: string, indent = 2): string {
  return restyle(text, { indent, lineWidth: 0, collectionStyle: 'flow' });
}

function restyle(text: string, options: Parameters<ParsedDoc['toString']>[0]): string {
  if (text.trim() === '') return text;
  const docs = parseStream(text);
  if (docs.length === 0 || docs.some((doc) => doc.errors.length > 0)) return text;
  // Each parsed document knows whether it needs its own `---` marker, so the
  // stream reassembles by concatenation (every `toString` ends with a newline).
  return docs.map((doc) => doc.toString(options)).join('');
}

/**
 * YAML → JSON. A multi-document stream becomes a JSON **array** of documents,
 * because JSON has no document separator and dropping all but the first would
 * lose data silently. Throws on a document that does not parse — the caller
 * gates the button on `validateYaml`.
 */
export function yamlToJson(text: string, indent = 2): string {
  const docs = parseStream(text);
  const values = docs.map((doc) => {
    if (doc.errors.length > 0) throw new Error(doc.errors[0]?.message ?? 'invalid YAML');
    return doc.toJS(TO_JS_OPTIONS) as unknown;
  });
  const value = values.length === 1 ? values[0] : values;
  return JSON.stringify(value, null, indent);
}

/** JSON → YAML. Throws on invalid JSON; the caller gates the button. */
export function jsonToYaml(text: string, indent = 2): string {
  const value: unknown = JSON.parse(text);
  return stringify(value, { indent, lineWidth: 0 });
}
