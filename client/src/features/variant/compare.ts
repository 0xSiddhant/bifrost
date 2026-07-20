import { validateJson } from '../../core/json';
import { diffJson, type DiffOptions, type DiffRecord } from '../../core/json/diff';
import type { TextNormalizeOptions } from '../../core/textNormalize';

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
 */
export function compareJson(
  leftText: string,
  rightText: string,
  options: VariantJsonOptions,
): CompareOutcome {
  const leftBad = leftText.trim() === '' || validateJson(leftText).length > 0;
  const rightBad = rightText.trim() === '' || validateJson(rightText).length > 0;
  if (leftBad || rightBad) {
    return { ok: false, invalid: leftBad && rightBad ? 'both' : leftBad ? 'left' : 'right' };
  }
  const records = diffJson(
    JSON.parse(leftText) as unknown,
    JSON.parse(rightText) as unknown,
    toDiffOptions(options),
  );
  return { ok: true, records };
}

export interface DiffStats {
  adds: number;
  removes: number;
  changes: number;
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
