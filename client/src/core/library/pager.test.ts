import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../log';
import { doc, memoryEntry } from './__fixtures__/memoryEntry';
import { LibraryPager } from './pager';
import { compareItems } from './paging';
import type { LibraryItem, LibraryKind, LibraryQuery } from './types';

afterEach(() => vi.restoreAllMocks());

/** 20 documents over three kinds, with deliberate ties on the sort key. */
function library() {
  const kinds: LibraryKind[] = ['runestone', 'edda', 'groot'];
  const rows: LibraryItem[] = [];
  for (let index = 0; index < 20; index += 1) {
    const kind = kinds[index % 3] ?? 'runestone';
    rows.push(
      doc(kind, `id${String(index).padStart(2, '0')}`, Math.floor(index / 2), {
        name: index % 4 === 0 ? 'Same' : `Doc ${index % 7}`,
        sizeBytes: 10 + (index % 3),
      }),
    );
  }
  const entries = kinds.map((kind) =>
    memoryEntry(
      kind,
      rows.filter((row) => row.kind === kind),
    ),
  );
  return { rows, entries };
}

const key = (row: LibraryItem) => `${row.kind}:${row.id}`;

describe('LibraryPager', () => {
  const queries: LibraryQuery[] = [
    { sort: 'modified', order: 'desc' },
    { sort: 'modified', order: 'asc' },
    { sort: 'name', order: 'asc' },
    { sort: 'size', order: 'desc' },
  ];

  it.each(queries)(
    'walking 1 → n shows every row once, in one merged order (%o)',
    async (query) => {
      const { rows, entries } = library();
      const expected = [...rows].sort((a, b) => compareItems(a, b, query.sort, query.order));
      const pager = new LibraryPager(entries, query);

      const first = await pager.page(1);
      expect(first.pageCount).toBe(7); // 20 rows at 3 per page
      const seen: LibraryItem[] = [...first.rows];
      for (let page = 2; page <= first.pageCount; page += 1) {
        const view = await pager.page(page);
        expect(view.from).toBe((page - 1) * 3 + 1);
        seen.push(...view.rows);
      }
      expect(seen.map(key)).toEqual(expected.map(key));
    },
  );

  it.each(queries)(
    'the last page, computed backwards, equals the forward walk (%o)',
    async (query) => {
      const { rows, entries } = library();
      const expected = [...rows].sort((a, b) => compareItems(a, b, query.sort, query.order));

      const cold = await new LibraryPager(entries, query).page(7);
      expect(cold.page).toBe(7);
      expect(cold.rows.map(key)).toEqual(expected.slice(18).map(key));
      expect(cold.from).toBe(19);
      expect(cold.to).toBe(20);

      // A deep cold page walks from the nearer end and still lands exactly.
      const five = await new LibraryPager(entries, query).page(5);
      expect(five.rows.map(key)).toEqual(expected.slice(12, 15).map(key));
      const three = await new LibraryPager(entries, query).page(3);
      expect(three.rows.map(key)).toEqual(expected.slice(6, 9).map(key));
    },
  );

  it('asks a lone kind for offset (k−1)·s directly, with no merge walk', async () => {
    const { entries } = library();
    const edda = entries[1];
    if (!edda) throw new Error('fixture');
    const pager = new LibraryPager([edda], { sort: 'modified', order: 'desc' });
    await pager.page(3);
    expect(edda.calls.map((call) => call.offset)).toEqual([0, 6]);
  });

  it('clamps a page past the end to the last page', async () => {
    const { entries } = library();
    const view = await new LibraryPager(entries, { sort: 'modified', order: 'desc' }).page(999);
    expect(view.page).toBe(7);
    expect(view.rows).toHaveLength(2);
  });

  it('shows an empty library as one empty page', async () => {
    const view = await new LibraryPager([memoryEntry('edda', [])], {
      sort: 'modified',
      order: 'desc',
    }).page(1);
    expect(view).toMatchObject({ page: 1, pageCount: 1, total: 0, from: 0, to: 0, rows: [] });
  });

  it('restarts without a kind that fails mid-walk, and names it', async () => {
    vi.spyOn(log, 'reportError').mockImplementation(() => undefined);
    const { entries } = library();
    const flaky = entries[2];
    if (!flaky) throw new Error('fixture');
    let calls = 0;
    const listPage = flaky.listPage;
    flaky.listPage = (query, request) => {
      calls += 1;
      return calls > 1 ? Promise.reject(new Error('502')) : listPage(query, request);
    };
    const pager = new LibraryPager(entries, { sort: 'modified', order: 'desc' });
    await pager.page(1);
    const view = await pager.page(2);
    expect(view.failed).toEqual(['groot']);
    // Only the two healthy kinds remain, counted from scratch.
    expect(view.total).toBe(14);
    expect(view.rows.every((row) => row.kind !== 'groot')).toBe(true);
  });

  it('refetches the current page in place after an own delete, and steps back from an emptied last page', async () => {
    const edda = memoryEntry('edda', [
      doc('edda', 'a', 4),
      doc('edda', 'b', 3),
      doc('edda', 'c', 2),
      doc('edda', 'd', 1),
    ]);
    const runestone = memoryEntry('runestone', []);
    const pager = new LibraryPager([edda, runestone], { sort: 'modified', order: 'desc' });
    const last = await pager.page(2);
    expect(last.rows.map((row) => row.id)).toEqual(['d']);

    // Delete 'd' on the server, then refresh the page it sat on.
    const remaining = [doc('edda', 'a', 4), doc('edda', 'b', 3), doc('edda', 'c', 2)];
    const fresh = memoryEntry('edda', remaining);
    edda.listPage = fresh.listPage;
    const after = await pager.refreshAfterDelete(2);
    expect(after.page).toBe(1);
    expect(after.pageCount).toBe(1);
    expect(after.rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('pulls the next row up after a mid-page delete, with no duplicate and no gap', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, index) =>
      doc('edda', id, 100 - index),
    );
    const edda = memoryEntry('edda', rows);
    const pager = new LibraryPager([edda, memoryEntry('runestone', [])], {
      sort: 'modified',
      order: 'desc',
    });
    await pager.page(1);
    const two = await pager.page(2);
    expect(two.rows.map((row) => row.id)).toEqual(['d', 'e', 'f']);
    edda.listPage = memoryEntry(
      'edda',
      rows.filter((row) => row.id !== 'e'),
    ).listPage;
    const after = await pager.refreshAfterDelete(2);
    expect(after.rows.map((row) => row.id)).toEqual(['d', 'f', 'g']);
  });

  it('abandons a walk that a live change overtakes, and rebuilds from the fresh list', async () => {
    let rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, index) => doc('edda', id, 100 - index));
    const edda = memoryEntry('edda', rows);
    const runestone = memoryEntry('runestone', []);
    const pager = new LibraryPager([edda, runestone], { sort: 'modified', order: 'desc' });
    await pager.page(1);

    // While the walk to page 3 is awaiting its first step, a newer document
    // lands and the page invalidates — exactly what the SSE handler does.
    const serve = edda.listPage;
    let armed = true;
    edda.listPage = async (query, request) => {
      const answer = await serve(query, request);
      if (armed) {
        armed = false;
        rows = [doc('edda', 'z', 999), ...rows];
        edda.listPage = memoryEntry('edda', rows).listPage;
        pager.invalidate();
      }
      return answer;
    };
    const three = await pager.page(3);
    // z, a, b | c, d, e | f, g — computed from the list as it now is.
    expect(three.rows.map((row) => row.id)).toEqual(['f', 'g']);
    expect(three.total).toBe(8);
  });
});
