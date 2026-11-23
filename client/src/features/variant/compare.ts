import { Text } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';
import { parseJsonValue, sortJsonKeys, validateJson, type JsonFormat } from '../../core/json';
import { diffJson, type DiffOptions, type DiffRecord } from '../../core/json/diff';
import { normalizeText, type TextNormalizeOptions } from '../../core/textNormalize';
import type { DiffHighlight } from '../../core/ui/JsonEditor';

/**
 * Pure compare-flow logic for Variant (PLAN-08). The page component stays a
 * thin shell over these so the fallback/stale behavior is unit-testable.
 */

export interface VariantJsonOptions {
  ignoreKeyOrder: boolean;
  arrayStrategy: 'index' | 'key' | 'set';
  /** Identity field for the `key` strategy. */
  arrayKeyField: string;
  /** Raw input; '' disables tolerance. */
  epsilon: string;
  /** Ignore-path globs, one per line (or comma-separated). */
  ignorePaths: string;
  caseInsensitiveStrings: boolean;
}

export interface VariantTextOptions {
  trimLines: boolean;
  stripWhitespace: boolean;
  ignoreCase: boolean;
  dropBlankLines: boolean;
}

export const DEFAULT_JSON_OPTIONS: VariantJsonOptions = {
  ignoreKeyOrder: true,
  arrayStrategy: 'index',
  arrayKeyField: 'id',
  epsilon: '',
  ignorePaths: '',
  caseInsensitiveStrings: false,
};

export const DEFAULT_TEXT_OPTIONS: VariantTextOptions = {
  trimLines: false,
  stripWhitespace: false,
  ignoreCase: false,
  dropBlankLines: false,
};

export function toDiffOptions(options: VariantJsonOptions): DiffOptions {
  const epsilon = Number(options.epsilon);
  return {
    ignoreKeyOrder: options.ignoreKeyOrder,
    arrayStrategy:
      options.arrayStrategy === 'key'
        ? { kind: 'key', field: options.arrayKeyField.trim() || 'id' }
        : { kind: options.arrayStrategy },
    epsilon: options.epsilon.trim() !== '' && Number.isFinite(epsilon) ? Math.abs(epsilon) : 0,
    ignorePaths: options.ignorePaths
      .split(/[\n,]/)
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern !== ''),
    caseInsensitiveStrings: options.caseInsensitiveStrings,
  };
}

export function toNormalizeOptions(options: VariantTextOptions): TextNormalizeOptions {
  return {
    normalizeEol: true,
    trimLines: options.trimLines,
    stripWhitespace: options.stripWhitespace,
    ignoreCase: options.ignoreCase,
    dropBlankLines: options.dropBlankLines,
  };
}

export type InvalidSide = 'left' | 'right' | 'both';

export type CompareOutcome =
  | { ok: true; records: DiffRecord[] }
  | { ok: false; invalid: InvalidSide };

/**
 * Run a structural compare, or report which side keeps it from running — the
 * page turns that into the "switched to Text" fallback banner (never a dead
 * end). An empty document counts as invalid JSON for comparing purposes.
 *
 * Each side may be strict JSON or JSONC (PLAN-42). Both are read as JSONC —
 * strict JSON is a subset and parses to the same value — so comments are not
 * data and a comment-only change makes no record; the pane text is untouched.
 */
export function compareJson(
  leftText: string,
  rightText: string,
  options: VariantJsonOptions,
): CompareOutcome {
  const leftBad = leftText.trim() === '' || validateJson(leftText, 'jsonc').length > 0;
  const rightBad = rightText.trim() === '' || validateJson(rightText, 'jsonc').length > 0;
  if (leftBad || rightBad) {
    return { ok: false, invalid: leftBad && rightBad ? 'both' : leftBad ? 'left' : 'right' };
  }
  const records = diffJson(
    parseJsonValue(leftText, 'jsonc'),
    parseJsonValue(rightText, 'jsonc'),
    toDiffOptions(options),
  );
  return { ok: true, records };
}

/** The narrowest format a pane's text is valid in, or null when it is in neither. */
export function paneFormat(text: string): JsonFormat | null {
  if (text.trim() === '' || validateJson(text, 'jsonc').length > 0) return null;
  return validateJson(text).length === 0 ? 'json' : 'jsonc';
}

export type SortBothOutcome =
  | { ok: true; left: string; right: string }
  | { ok: false; reason: 'invalid' | 'refused' };

/**
 * Sort both panes' keys, judged on the text as it is now — never on the
 * debounced copy the toolbar reads, which can be a keystroke behind. A strict
 * side keeps strict JSON's sort; a JSONC side gets the comment-safe one, and
 * if that refuses, neither side changes.
 */
export function sortBothSides(leftText: string, rightText: string): SortBothOutcome {
  const leftFormat = paneFormat(leftText);
  const rightFormat = paneFormat(rightText);
  if (!leftFormat || !rightFormat) return { ok: false, reason: 'invalid' };
  const left = sortJsonKeys(leftText, leftFormat);
  const right = sortJsonKeys(rightText, rightFormat);
  if (left === null || right === null) return { ok: false, reason: 'refused' };
  return { ok: true, left, right };
}

export interface DiffStats {
  adds: number;
  removes: number;
  changes: number;
}

/**
 * Bound the char-level Myers diff: two large, mostly-different documents
 * (think minified JSON on a single enormous line) otherwise freeze the tab
 * for minutes. Past the limit the diff falls back to a coarser but instant
 * line-level result.
 */
export const TEXT_DIFF_CONFIG = { scanLimit: 500, timeout: 300 } as const;

export interface TextChunkRow {
  kind: 'add' | 'remove' | 'change';
  label: string;
  posA: number;
  posB: number;
}

export interface TextCompareResult {
  /** Normalized snapshots the chunk rows and highlights refer to. */
  left: string;
  right: string;
  rows: TextChunkRow[];
  stats: DiffStats;
  /**
   * Pane decorations (valid against the snapshots). When destructive
   * normalization is on the pane buffers differ from the snapshots, so the
   * page must not paint these — the rows/stats still apply.
   */
  highlights: { left: DiffHighlight[]; right: DiffHighlight[] };
}

/** Same budget rationale as the JSON side — walls of tint cost, not inform. */
const MAX_DECORATED_CHUNKS = 500;

/**
 * Run a text compare over normalized snapshots. Owner's model: diffing
 * happens only on the Compare CTA — never per keystroke — so this is called
 * from exactly one place and its output is frozen until the next compare.
 */
export function compareText(
  leftText: string,
  rightText: string,
  options: VariantTextOptions,
): TextCompareResult {
  const normalize = toNormalizeOptions(options);
  const left = normalizeText(leftText, normalize);
  const right = normalizeText(rightText, normalize);
  const docA = Text.of(left.split('\n'));
  const docB = Text.of(right.split('\n'));
  const chunks = Chunk.build(docA, docB, TEXT_DIFF_CONFIG);
  const lines = (doc: Text, from: number, end: number) => {
    const a = doc.lineAt(Math.min(from, doc.length)).number;
    const b = doc.lineAt(Math.min(end, doc.length)).number;
    return a === b ? `${a}` : `${a}–${b}`;
  };
  const rows: TextChunkRow[] = chunks.map((chunk) => {
    const kind =
      chunk.fromA === chunk.toA ? 'add' : chunk.fromB === chunk.toB ? 'remove' : 'change';
    const spanA = lines(docA, chunk.fromA, chunk.endA);
    const spanB = lines(docB, chunk.fromB, chunk.endB);
    const label =
      kind === 'add'
        ? `line ${spanB} (right)`
        : kind === 'remove'
          ? `line ${spanA} (left)`
          : `left ${spanA} ↔ right ${spanB}`;
    return {
      kind,
      label,
      posA: Math.min(chunk.fromA, docA.length),
      posB: Math.min(chunk.fromB, docB.length),
    };
  });
  const stats = { adds: 0, removes: 0, changes: 0 };
  for (const row of rows) {
    if (row.kind === 'add') stats.adds += 1;
    else if (row.kind === 'remove') stats.removes += 1;
    else stats.changes += 1;
  }

  // Chunk spans → line tints; per-chunk changes → char emphasis. Deletions
  // paint the left pane, insertions the right, changed chunks both.
  const leftMarks: DiffHighlight[] = [];
  const rightMarks: DiffHighlight[] = [];
  for (const chunk of chunks.slice(0, MAX_DECORATED_CHUNKS)) {
    const kind =
      chunk.fromA === chunk.toA ? 'add' : chunk.fromB === chunk.toB ? 'remove' : 'change';
    if (chunk.toA > chunk.fromA && kind !== 'add') {
      const paneKind = kind === 'remove' ? 'remove' : 'change';
      leftMarks.push({ from: chunk.fromA, to: chunk.endA, kind: paneKind, level: 'line' });
    }
    if (chunk.toB > chunk.fromB && kind !== 'remove') {
      const paneKind = kind === 'add' ? 'add' : 'change';
      rightMarks.push({ from: chunk.fromB, to: chunk.endB, kind: paneKind, level: 'line' });
    }
    for (const change of chunk.changes) {
      if (change.toA > change.fromA && kind !== 'add') {
        leftMarks.push({
          from: chunk.fromA + change.fromA,
          to: chunk.fromA + change.toA,
          kind: kind === 'remove' ? 'remove' : 'change',
          level: 'char',
        });
      }
      if (change.toB > change.fromB && kind !== 'remove') {
        rightMarks.push({
          from: chunk.fromB + change.fromB,
          to: chunk.fromB + change.toB,
          kind: kind === 'add' ? 'add' : 'change',
          level: 'char',
        });
      }
    }
  }

  return { left, right, rows, stats, highlights: { left: leftMarks, right: rightMarks } };
}

export function diffStats(records: readonly DiffRecord[]): DiffStats {
  let adds = 0;
  let removes = 0;
  let changes = 0;
  for (const record of records) {
    if (record.op === 'add') adds += 1;
    else if (record.op === 'remove') removes += 1;
    else changes += 1;
  }
  return { adds, removes, changes };
}
