import { describe, expect, it } from 'vitest';
import { doc } from './__fixtures__/memoryEntry';
import {
  compareCodePoints,
  compareItems,
  mergeHeads,
  pageCount,
  pageWindow,
  parsePageParam,
} from './paging';
import type { LibraryItem } from './types';

describe('compareItems', () => {
  it('folds ASCII case only, as SQLite lower() does', () => {
    const upper = doc('edda', 'a', 0, { name: 'Zebra' });
    const lower = doc('edda', 'b', 0, { name: 'apple' });
    expect(compareItems(lower, upper, 'name', 'asc')).toBeLessThan(0);
    // 'É' is not folded by SQLite, so it sorts after every ASCII letter.
    const accented = doc('edda', 'c', 0, { name: 'Éclair' });
    expect(compareItems(upper, accented, 'name', 'asc')).toBeLessThan(0);
  });

  it('compares by code point, not UTF-16 unit', () => {
    expect(compareCodePoints('\u{1F600}', '�')).toBeGreaterThan(0);
    expect('\u{1F600}' < '�').toBe(true);
  });

  it('breaks ties on id then kind, in the sort direction, so desc mirrors asc exactly', () => {
    const rows = [
      doc('edda', 'b', 5),
      doc('runestone', 'b', 5),
      doc('edda', 'a', 5),
      doc('groot', 'c', 9),
    ];
    const asc = [...rows].sort((a, b) => compareItems(a, b, 'modified', 'asc'));
    const desc = [...rows].sort((a, b) => compareItems(a, b, 'modified', 'desc'));
    expect(desc).toEqual([...asc].reverse());
    expect(asc.map((row) => `${row.kind}:${row.id}`)).toEqual([
      'edda:a',
      'edda:b',
      'runestone:b',
      'groot:c',
    ]);
  });
});

describe('mergeHeads', () => {
  const asc = (a: LibraryItem, b: LibraryItem) => compareItems(a, b, 'modified', 'asc');

  it('takes the first rows of the merge and counts what each stream gave', () => {
    const merged = mergeHeads(
      [
        { kind: 'runestone', rows: [doc('runestone', 'a', 1), doc('runestone', 'b', 4)] },
        { kind: 'edda', rows: [doc('edda', 'c', 2), doc('edda', 'd', 3)] },
        { kind: 'groot', rows: [] },
      ],
      3,
      asc,
    );
    expect(merged.rows.map((row) => row.id)).toEqual(['a', 'c', 'd']);
    expect(merged.consumed).toEqual({ runestone: 1, edda: 2, groot: 0 });
  });

  it('stops early when every stream runs dry', () => {
    const merged = mergeHeads([{ kind: 'edda', rows: [doc('edda', 'a', 1)] }], 30, asc);
    expect(merged.rows).toHaveLength(1);
  });

  // The ⚠️ in PLAN-31: a comparator that disagrees with a stream's own order
  // may change how kinds interleave, never how many rows a kind gives.
  it('consumes each stream strictly in its own order even when the comparator disagrees', () => {
    // Server order says z then a; the comparator (by name asc) would put a first.
    const stream = [doc('edda', 'z', 0, { name: 'z' }), doc('edda', 'a', 0, { name: 'a' })];
    const merged = mergeHeads(
      [
        { kind: 'edda', rows: stream },
        { kind: 'runestone', rows: [doc('runestone', 'm', 0, { name: 'm' })] },
      ],
      2,
      (a, b) => compareItems(a, b, 'name', 'asc'),
    );
    // The head of edda is 'z', so runestone's 'm' wins first — and edda gives
    // its rows in its own order, 'z' before 'a', whatever the comparator thinks.
    expect(merged.rows.map((row) => row.name)).toEqual(['m', 'z']);
    expect(merged.consumed).toEqual({ edda: 1, runestone: 1 });
  });
});

describe('pageWindow', () => {
  const controls = (slots: ReturnType<typeof pageWindow>) => slots.length + 2; // + prev/next

  it('is just page 1 for one page', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('shows both pages for two', () => {
    expect(pageWindow(1, 2)).toEqual([1, 2]);
    expect(pageWindow(2, 2)).toEqual([1, 2]);
  });

  it('windows seven pages at every position', () => {
    expect(pageWindow(1, 7)).toEqual([1, 2, 'gap', 7]);
    expect(pageWindow(2, 7)).toEqual([1, 2, 3, 'gap', 7]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 'gap', 7]);
    expect(pageWindow(4, 7)).toEqual([1, 'gap', 3, 4, 5, 'gap', 7]);
    expect(pageWindow(5, 7)).toEqual([1, 'gap', 4, 5, 6, 7]);
    expect(pageWindow(7, 7)).toEqual([1, 'gap', 6, 7]);
  });

  it('never exceeds nine controls, even at forty pages', () => {
    for (let current = 1; current <= 40; current += 1) {
      const slots = pageWindow(current, 40);
      expect(controls(slots)).toBeLessThanOrEqual(9);
      expect(slots[0]).toBe(1);
      expect(slots.at(-1)).toBe(40);
      expect(slots).toContain(current);
    }
    expect(pageWindow(17, 40)).toEqual([1, 'gap', 16, 17, 18, 'gap', 40]);
  });
});

describe('parsePageParam and pageCount', () => {
  it('reads anything but a positive integer as page 1', () => {
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam('0')).toBe(1);
    expect(parsePageParam('abc')).toBe(1);
    expect(parsePageParam('-3')).toBe(1);
    expect(parsePageParam('2.5')).toBe(1);
    expect(parsePageParam('4')).toBe(4);
  });

  it('counts at least one page', () => {
    expect(pageCount(0, 30)).toBe(1);
    expect(pageCount(75, 30)).toBe(3);
    expect(pageCount(90, 30)).toBe(3);
  });
});
