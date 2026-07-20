import { docRanges } from '../../core/json';
import type { DiffRecord } from '../../core/json/diff';
import type { DiffHighlight } from '../../core/ui/JsonEditor';

/**
 * Map diff records onto editor decorations (PLAN-08): deletions paint the
 * left pane (the only place deleted content physically exists), additions the
 * right, modifications both — soft line tint plus char-level emphasis on the
 * exact value span. Offsets resolve against the compared snapshots; each
 * snapshot is parsed exactly once no matter how many records there are.
 */

export interface PaneHighlights {
  left: DiffHighlight[];
  right: DiffHighlight[];
}

export interface JumpTarget {
  left: number | null;
  right: number | null;
}

/**
 * Decoration budget: past this many records the panes are wall-to-wall tint
 * anyway — extra decorations cost real layout time on MB-scale compares while
 * adding zero legibility. The drawer still lists everything.
 */
export const MAX_DECORATED_RECORDS = 800;

function push(
  out: DiffHighlight[],
  doc: ReturnType<typeof docRanges>,
  path: readonly (string | number)[],
  kind: DiffHighlight['kind'],
): void {
  const wide = doc.rangeAt(path, true);
  if (!wide) return;
  out.push({ from: wide.offset, to: wide.offset + wide.length, kind, level: 'line' });
  const value = doc.rangeAt(path, false);
  if (value) {
    out.push({ from: value.offset, to: value.offset + value.length, kind, level: 'char' });
  }
}

export function recordsToHighlights(
  records: readonly DiffRecord[],
  leftText: string,
  rightText: string,
): PaneHighlights {
  const leftDoc = docRanges(leftText);
  const rightDoc = docRanges(rightText);
  const left: DiffHighlight[] = [];
  const right: DiffHighlight[] = [];
  const budget = records.slice(0, MAX_DECORATED_RECORDS);
  for (const record of budget) {
    if (record.aspect === 'key-order') {
      // Order-only difference: tint the object's opening line on both sides.
      for (const [doc, path, out] of [
        [leftDoc, record.leftPath, left] as const,
        [rightDoc, record.rightPath, right] as const,
      ]) {
        if (path === null) continue;
        const range = doc.rangeAt(path);
        if (range) out.push({ from: range.offset, to: range.offset, kind: 'change', level: 'line' });
      }
      continue;
    }
    if (record.op === 'remove' && record.leftPath) {
      push(left, leftDoc, record.leftPath, 'remove');
    } else if (record.op === 'add' && record.rightPath) {
      push(right, rightDoc, record.rightPath, 'add');
    } else if (record.op === 'change' || record.op === 'type-change') {
      if (record.leftPath) push(left, leftDoc, record.leftPath, 'change');
      if (record.rightPath) push(right, rightDoc, record.rightPath, 'change');
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
  const left = record.leftPath ? docRanges(leftText).rangeAt(record.leftPath, true) : null;
  const right = record.rightPath ? docRanges(rightText).rangeAt(record.rightPath, true) : null;
  return { left: left ? left.offset : null, right: right ? right.offset : null };
}
