import { describe, expect, it } from 'vitest';
import {
  compareJson,
  DEFAULT_JSON_OPTIONS,
  diffStats,
  toDiffOptions,
} from './compare';
import { jumpTargetFor, recordsToHighlights } from './highlights';

describe('compareJson fallback behavior', () => {
  it('reports which side is invalid (drives the text-mode fallback banner)', () => {
    expect(compareJson('{ broken', '{}', DEFAULT_JSON_OPTIONS)).toEqual({
      ok: false,
      invalid: 'left',
    });
    expect(compareJson('{}', 'nope{', DEFAULT_JSON_OPTIONS)).toEqual({
      ok: false,
      invalid: 'right',
    });
    expect(compareJson('', '', DEFAULT_JSON_OPTIONS)).toEqual({ ok: false, invalid: 'both' });
  });

  it('runs the structural diff when both sides parse', () => {
    const outcome = compareJson('{"a": 1}', '{"a": 2}', DEFAULT_JSON_OPTIONS);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.records).toMatchObject([{ op: 'change', path: ['a'] }]);
    }
  });

  it('shuffled keys + different formatting compare clean by default (acceptance 1)', () => {
    const left = '{\n  "b": [1, 2],\n  "a": {"y": 1, "x": 2}\n}';
    const right = '{"a":{"x":2,"y":1},"b":[1,2]}';
    const outcome = compareJson(left, right, DEFAULT_JSON_OPTIONS);
    expect(outcome).toEqual({ ok: true, records: [] });
  });
});

describe('toDiffOptions parsing', () => {
  it('parses epsilon and splits ignore globs on newlines and commas', () => {
    const options = toDiffOptions({
      ...DEFAULT_JSON_OPTIONS,
      epsilon: '0.001',
      ignorePaths: '**.updatedAt\n , items[*].etag,',
    });
    expect(options.epsilon).toBe(0.001);
    expect(options.ignorePaths).toEqual(['**.updatedAt', 'items[*].etag']);
  });

  it('treats blank or garbage epsilon as off', () => {
    expect(toDiffOptions({ ...DEFAULT_JSON_OPTIONS, epsilon: '' }).epsilon).toBe(0);
    expect(toDiffOptions({ ...DEFAULT_JSON_OPTIONS, epsilon: 'abc' }).epsilon).toBe(0);
  });

  it('falls back to id when the key field is blank', () => {
    const options = toDiffOptions({
      ...DEFAULT_JSON_OPTIONS,
      arrayStrategy: 'key',
      arrayKeyField: '  ',
    });
    expect(options.arrayStrategy).toEqual({ kind: 'key', field: 'id' });
  });
});

describe('diffStats', () => {
  it('counts type-changes as changes for the +/−/~ chip', () => {
    const outcome = compareJson(
      '{"gone": 1, "same": 2, "mut": 3}',
      '{"same": 2, "mut": "3", "born": 4}',
      DEFAULT_JSON_OPTIONS,
    );
    if (!outcome.ok) throw new Error('expected ok');
    expect(diffStats(outcome.records)).toEqual({ adds: 1, removes: 1, changes: 1 });
  });
});

describe('recordsToHighlights', () => {
  const left = '{\n  "gone": true,\n  "price": 9,\n  "keep": 1\n}';
  const right = '{\n  "price": 12,\n  "keep": 1,\n  "born": []\n}';
  const outcome = compareJson(left, right, DEFAULT_JSON_OPTIONS);
  if (!outcome.ok) throw new Error('expected ok');
  const highlights = recordsToHighlights(outcome.records, left, right);

  it('paints removals only in the left pane, additions only in the right', () => {
    const leftKinds = new Set(highlights.left.map((h) => h.kind));
    const rightKinds = new Set(highlights.right.map((h) => h.kind));
    expect(leftKinds).toEqual(new Set(['remove', 'change']));
    expect(rightKinds).toEqual(new Set(['add', 'change']));
  });

  it('emits a line tint spanning the property plus char emphasis on the value', () => {
    const removeLine = highlights.left.find((h) => h.kind === 'remove' && h.level === 'line');
    const removeChar = highlights.left.find((h) => h.kind === 'remove' && h.level === 'char');
    expect(removeLine).toBeTruthy();
    expect(removeChar).toBeTruthy();
    if (!removeLine || !removeChar) return;
    expect(left.slice(removeLine.from, removeLine.to)).toBe('"gone": true');
    expect(left.slice(removeChar.from, removeChar.to)).toBe('true');
  });

  it('paints the change on both panes at each pane’s own offsets', () => {
    const leftChar = highlights.left.find((h) => h.kind === 'change' && h.level === 'char');
    const rightChar = highlights.right.find((h) => h.kind === 'change' && h.level === 'char');
    expect(leftChar && left.slice(leftChar.from, leftChar.to)).toBe('9');
    expect(rightChar && right.slice(rightChar.from, rightChar.to)).toBe('12');
  });

  it('marks key-order records as a line tint on both panes', () => {
    const a = '{"x": 1, "y": 2}';
    const b = '{"y": 2, "x": 1}';
    const ordered = compareJson(a, b, { ...DEFAULT_JSON_OPTIONS, ignoreKeyOrder: false });
    if (!ordered.ok) throw new Error('expected ok');
    const marks = recordsToHighlights(ordered.records, a, b);
    expect(marks.left).toHaveLength(1);
    expect(marks.right).toHaveLength(1);
    expect(marks.left[0]).toMatchObject({ kind: 'change', level: 'line' });
  });
});

describe('jumpTargetFor (drawer click-to-jump)', () => {
  it('resolves both panes for a change and one pane for add/remove', () => {
    const left = '{"gone": 1, "v": 2}';
    const right = '{"v": 3, "born": 4}';
    const outcome = compareJson(left, right, DEFAULT_JSON_OPTIONS);
    if (!outcome.ok) throw new Error('expected ok');

    const change = outcome.records.find((r) => r.op === 'change');
    const remove = outcome.records.find((r) => r.op === 'remove');
    const add = outcome.records.find((r) => r.op === 'add');
    if (!change || !remove || !add) throw new Error('expected all three record ops');

    const changeTarget = jumpTargetFor(change, left, right);
    expect(changeTarget.left).toBe(left.indexOf('"v"'));
    expect(changeTarget.right).toBe(right.indexOf('"v"'));

    expect(jumpTargetFor(remove, left, right)).toEqual({
      left: left.indexOf('"gone"'),
      right: null,
    });
    expect(jumpTargetFor(add, left, right)).toEqual({
      left: null,
      right: right.indexOf('"born"'),
    });
  });
});
