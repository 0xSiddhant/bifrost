/**
 * Convert already-valid JSON into a JavaScript object-literal (Loki, PLAN-12) —
 * the util behind Runestone's "Copy as JS". Demo spec (cases D/E, decisions
 * 2026-07-21): identifier keys are unquoted, non-identifier keys (`data-id`,
 * numeric-leading, empty) stay quoted, strings become single-quoted.
 *
 * Input is trusted-valid JSON (the caller enables the action only on Valid
 * JSON ✓), so this parses and re-emits — safe by construction, no `eval`.
 * `JSON.parse(json)` deep-equals `eval(jsonToJs(json))` (property-tested).
 */

import { stringifyJs } from './strings';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function emit(value: unknown, indent: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return stringifyJs(value, 'single');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = indent + '  ';
    const items = value.map((item) => inner + emit(item, inner)).join(',\n');
    return `[\n${items},\n${indent}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const inner = indent + '  ';
    const lines = entries
      .map(([key, val]) => {
        const k = IDENTIFIER.test(key) ? key : stringifyJs(key, 'single');
        return `${inner}${k}: ${emit(val, inner)}`;
      })
      .join(',\n');
    return `{\n${lines},\n${indent}}`;
  }

  // JSON never yields undefined/function/etc.; be explicit for exhaustiveness.
  return 'null';
}

export function jsonToJs(json: string): string {
  const value: unknown = JSON.parse(json);
  return emit(value, '');
}
