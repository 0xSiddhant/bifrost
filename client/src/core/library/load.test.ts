import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../log';
import { doc, memoryEntry } from './__fixtures__/memoryEntry';
import { loadLibraryStep } from './load';
import { LibraryPager } from './pager';
import { availableKinds, entryFor } from './registry';
import type { LibraryItem, LibraryKind, LibraryQuery } from './types';

const QUERY: LibraryQuery = { sort: 'modified', order: 'desc' };

afterEach(() => vi.restoreAllMocks());

describe('loadLibraryStep', () => {
  it('merges one server page per kind into one sorted page, with per-kind consumption', async () => {
    const entries = [
      memoryEntry('runestone', [doc('runestone', 'a', 10), doc('runestone', 'b', 40)]),
      memoryEntry('edda', [doc('edda', 'c', 30)]),
    ];

    const step = await loadLibraryStep(entries, QUERY, {});

    expect(step.rows.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(step.consumed).toEqual({ runestone: 2, edda: 1 });
    expect(step.totals).toEqual({ runestone: 2, edda: 1 });
    expect(step.limit).toBe(3);
    expect(step.failed).toEqual([]);
  });

  it('passes the same query and each kind its own offset', async () => {
    const listA = vi.fn(memoryEntry('runestone', []).listPage);
    const listB = vi.fn(memoryEntry('edda', []).listPage);
    const query: LibraryQuery = { q: 'notes', author: 'device-b', sort: 'size', order: 'asc' };

    await loadLibraryStep(
      [
        memoryEntry('runestone', [], { listPage: listA }),
        memoryEntry('edda', [], { listPage: listB }),
      ],
      query,
      { runestone: 6, edda: 2 },
      3,
    );

    expect(listA).toHaveBeenCalledWith(query, { offset: 6, limit: 3 });
    expect(listB).toHaveBeenCalledWith(query, { offset: 2, limit: 3 });
  });

  // PLAN-21 criterion 6, unchanged: the page is never blank because one module is down.
  it('returns the other kinds when one rejects, and never throws', async () => {
    vi.spyOn(log, 'reportError').mockImplementation(() => undefined);
    const entries = [
      memoryEntry('runestone', [doc('runestone', 'a', 10)]),
      memoryEntry('edda', [], { listPage: () => Promise.reject(new Error('502')) }),
      memoryEntry('groot', [doc('groot', 'g', 20)]),
    ];

    const { rows, failed } = await loadLibraryStep(entries, QUERY, {});

    expect(rows.map((item) => item.id)).toEqual(['g', 'a']);
    expect(failed).toEqual(['edda']);
  });

  // rules/coding.md: every failure path gets a line where it is handled.
  it('logs the kind that failed', async () => {
    const reportError = vi.spyOn(log, 'reportError').mockImplementation(() => undefined);
    const boom = new Error('502');

    await loadLibraryStep(
      [memoryEntry('edda', [], { listPage: () => Promise.reject(boom) })],
      QUERY,
      {},
    );

    expect(reportError).toHaveBeenCalledWith('library kind "edda" failed to load', boom, {
      module: 'pensieve',
    });
  });

  it('unions the author facets of the kinds that answered', async () => {
    const step = await loadLibraryStep(
      [
        memoryEntry('runestone', [doc('runestone', 'a', 1, { authorDeviceId: 'phone' })]),
        memoryEntry('edda', [doc('edda', 'b', 2, { authorDeviceId: 'mac' })]),
      ],
      QUERY,
      {},
    );
    expect(step.authors.sort()).toEqual(['mac', 'phone']);
  });
});

describe('availableKinds', () => {
  const registry = [
    memoryEntry('runestone', []),
    memoryEntry('edda', []),
    memoryEntry('groot', []),
  ];

  it('keeps only the kinds this profile serves', () => {
    const kinds = availableKinds(registry, (module) => module !== 'edda');
    expect(kinds.map((entry) => entry.kind)).toEqual(['runestone', 'groot']);
  });

  it('drops a kind entirely rather than listing it as unavailable', () => {
    expect(availableKinds(registry, () => false)).toEqual([]);
  });

  it('finds an entry by kind and answers undefined for one that is gone', () => {
    expect(entryFor(registry, 'groot')?.kind).toBe('groot');
    expect(entryFor([], 'groot')).toBeUndefined();
  });
});

/**
 * PLAN-21 criterion 11, kept through PLAN-31: a kind the shell has never heard
 * of is registered and must page, sort and delete through exactly the same
 * code paths, with no page change.
 */
describe('a fifth kind is one registry entry', () => {
  const scroll = (id: string, name: string, modifiedAt: number): LibraryItem => ({
    ...doc('scroll' as LibraryKind, id, modifiedAt),
    name,
  });

  const removed: string[] = [];
  const fifth = memoryEntry(
    'scroll' as LibraryKind,
    [scroll('s1', 'Ancient scroll', 25), scroll('s2', 'Bright scroll', 45)],
    {
      module: 'scroll',
      remove: (id: string) => {
        removed.push(id);
        return Promise.resolve(null);
      },
    },
  );
  const registry = [memoryEntry('runestone', [doc('runestone', 'a', 35)]), fifth];

  it('pages alongside the kinds that already existed', async () => {
    const view = await new LibraryPager(registry, QUERY).page(1);
    expect(view.rows.map((item) => item.id)).toEqual(['s2', 'a', 's1']);
    expect(view.total).toBe(3);
  });

  it('sorts and filters by the same rules', async () => {
    const byName = await new LibraryPager(registry, { sort: 'name', order: 'asc' }).page(1);
    expect(byName.rows.map((item) => item.name)).toEqual([
      'Ancient scroll',
      'Bright scroll',
      'runestone-a',
    ]);
    const searched = await new LibraryPager(registry, { ...QUERY, q: 'ancient' }).page(1);
    expect(searched.rows.map((item) => item.id)).toEqual(['s1']);
  });

  it('deletes through its own entry', async () => {
    const entry = entryFor(registry, 'scroll' as LibraryKind);
    await entry?.remove('s1');
    expect(removed).toEqual(['s1']);
  });

  it('is gated by its own capability, like every other kind', () => {
    const kinds = availableKinds(registry, (module) => module === 'scroll');
    expect(kinds.map((entry) => entry.kind)).toEqual(['scroll']);
  });
});
