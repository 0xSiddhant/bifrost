import { rangeAtPath } from '../../core/json';
import type { DiffRecord } from '../../core/json/diff';
import type { DiffHighlight } from '../../core/ui/JsonEditor';

/**
 * Map diff records onto editor decorations (PLAN-08): deletions paint the
 * left pane (the only place deleted content physically exists), additions the
 * right, modifications both — soft line tint plus char-level emphasis on the
 * exact value span. Offsets resolve against the compared snapshots.
 */

export interface PaneHighlights {
  left: DiffHighlight[];
  right: DiffHighlight[];
}

export interface JumpTarget {
  left: number | null;
  right: number | null;
}

function push(
  out: DiffHighlight[],
  text: string,
  path: readonly (string | number)[],
  kind: DiffHighlight['kind'],
): void {
  const wide = rangeAtPath(text, path, true);
  if (!wide) return;
  out.push({ from: wide.offset, to: wide.offset + wide.length, kind, level: 'line' });
  const value = rangeAtPath(text, path, false);
  if (value) {
    out.push({ from: value.offset, to: value.offset + value.length, kind, level: 'char' });
  }
}

export function recordsToHighlights(
  records: readonly DiffRecord[],
  leftText: string,
  rightText: string,
): PaneHighlights {
  const left: DiffHighlight[] = [];
  const right: DiffHighlight[] = [];
  for (const record of records) {
    if (record.aspect === 'key-order') {
      // Order-only difference: tint the object's opening line on both sides.
      for (const [text, path, out] of [
        [leftText, record.leftPath, left] as const,
        [rightText, record.rightPath, right] as const,
      ]) {
        if (path === null) continue;
        const range = rangeAtPath(text, path);
        if (range) out.push({ from: range.offset, to: range.offset, kind: 'change', level: 'line' });
      }
      continue;
    }
    if (record.op === 'remove' && record.leftPath) {
      push(left, leftText, record.leftPath, 'remove');
    } else if (record.op === 'add' && record.rightPath) {
      push(right, rightText, record.rightPath, 'add');
    } else if (record.op === 'change' || record.op === 'type-change') {
      if (record.leftPath) push(left, leftText, record.leftPath, 'change');
      if (record.rightPath) push(right, rightText, record.rightPath, 'change');
    }
  }
  return { left, right };
}

/** Doc offsets both panes should jump to for a record (null = no anchor there). */
export function jumpTargetFor(
  record: DiffRecord,
  leftText: string,
  rightText: string,
): JumpTarget {
  const left = record.leftPath ? rangeAtPath(leftText, record.leftPath, true) : null;
  const right = record.rightPath ? rangeAtPath(rightText, record.rightPath, true) : null;
  return { left: left ? left.offset : null, right: right ? right.offset : null };
}
