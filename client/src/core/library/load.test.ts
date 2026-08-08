import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../log';
import { loadLibrary } from './load';
import { LIBRARY_REGISTRY, availableKinds, entryFor } from './registry';
import { filterItems, sortItems } from './select';
import type { LibraryEntry, LibraryItem, LibraryKind, LibraryQuery } from './types';

const QUERY: LibraryQuery = { sort: 'modified', order: 'desc' };

function row(kind: LibraryKind, id: string, modifiedAt: number): LibraryItem {
  return {
    kind,
    id,
    name: `${kind}-${id}`,
    slug: `${kind}-${id}`,
    authorDeviceId: 'device-a',
    sizeBytes: 10,
    createdAt: modifiedAt,
    modifiedAt,
  };
}

/** A registry entry that answers from memory — no server, no fetch. */
function fakeEntry(kind: LibraryKind, rows: LibraryItem[], overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    kind,
    label: kind.toUpperCase(),
    module: kind,
    tone: 1,
    icon: null,
    events: [`${kind}.saved`, `${kind}.deleted`],
    noun: 'document',
    newRoute: `/${kind}`,
    newLabel: 'New',
    list: () => Promise.resolve(rows),
    remove: () => Promise.resolve(null),
    editorRoute: (item) => `/${kind}/${item.slug}`,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('loadLibrary', () => {
  it('merges every kind into one sorted list', async () => {
    const entries = [
      fakeEntry('runestone', [row('runestone', 'a', 10), row('runestone', 'b', 40)]),
      fakeEntry('edda', [row('edda', 'c', 30)]),
    ];

    const { items, failed } = await loadLibrary(entries, QUERY);

    expect(items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(failed).toEqual([]);
  });

  it('passes the same query to every kind', async () => {
    const listA = vi.fn(() => Promise.resolve([]));
    const listB = vi.fn(() => Promise.resolve([]));
    const query: LibraryQuery = { q: 'notes', author: 'device-b', sort: 'size', order: 'asc' };

    await loadLibrary(
      [fakeEntry('runestone', [], { list: listA }), fakeEntry('edda', [], { list: listB })],
      query,
    );

    expect(listA).toHaveBeenCalledWith(query);
    expect(listB).toHaveBeenCalledWith(query);
  });

  // Criterion 6: the page is never blank because one module is down.
  it('returns the other kinds when one rejects, and never throws', async () => {
    vi.spyOn(log, 'reportError').mockImplementation(() => undefined);
    const entries = [
      fakeEntry('runestone', [row('runestone', 'a', 10)]),
      fakeEntry('edda', [], { list: () => Promise.reject(new Error('502')) }),
      fakeEntry('groot', [row('groot', 'g', 20)]),
    ];

    const { items, failed } = await loadLibrary(entries, QUERY);

    expect(items.map((item) => item.id)).toEqual(['g', 'a']);
    expect(failed).toEqual(['edda']);
  });

  it('reports every failed kind when they all reject', async () => {
    vi.spyOn(log, 'reportError').mockImplementation(() => undefined);
    const down = (kind: LibraryKind) =>
      fakeEntry(kind, [], { list: () => Promise.reject(new Error('offline')) });

    const { items, failed } = await loadLibrary([down('runestone'), down('edda')], QUERY);

    expect(items).toEqual([]);
    expect(failed).toEqual(['runestone', 'edda']);
  });

  // rules/coding.md: every new failure path gets a line where it is handled.
  it('logs the kind that failed', async () => {
    const reportError = vi.spyOn(log, 'reportError').mockImplementation(() => undefined);
    const boom = new Error('502');

    await loadLibrary([fakeEntry('edda', [], { list: () => Promise.reject(boom) })], QUERY);

    expect(reportError).toHaveBeenCalledWith(
      'library kind "edda" failed to load',
      boom,
      { module: 'pensieve' },
    );
  });

  it('retries one kind by loading a one-entry registry', async () => {
    const recovered = fakeEntry('edda', [row('edda', 'c', 30)]);

    const { items, failed } = await loadLibrary([recovered], QUERY);

    expect(items.map((item) => item.id)).toEqual(['c']);
    expect(failed).toEqual([]);
  });
});

describe('availableKinds', () => {
  const registry = [fakeEntry('runestone', []), fakeEntry('edda', []), fakeEntry('groot', [])];

  it('keeps only the kinds this profile serves', () => {
    const kinds = availableKinds(registry, (module) => module !== 'edda');
    expect(kinds.map((entry) => entry.kind)).toEqual(['runestone', 'groot']);
  });

  // Criterion 7: a missing capability means no chip, no fetch, no subscription.
  it('drops a kind entirely rather than listing it as unavailable', () => {
    expect(availableKinds(registry, () => false)).toEqual([]);
  });

  it('finds an entry by kind and answers undefined for one that is gone', () => {
    expect(entryFor(registry, 'groot')?.kind).toBe('groot');
    expect(entryFor([], 'groot')).toBeUndefined();
  });
});

/**
 * Criterion 11 — the criterion that proves the plan's actual value. A kind the
 * shell has never heard of is registered and must list, filter, sort and delete
 * through exactly the same code paths, with **no page change**: everything the
 * page does to a row it does through the registry entry.
 */
describe('a fourth kind is one registry entry', () => {
  const scroll = (id: string, name: string, modifiedAt: number): LibraryItem => ({
    ...row('groot' as LibraryKind, id, modifiedAt),
    kind: 'scroll' as LibraryKind,
    name,
  });

  const removed: string[] = [];
  const fourth = fakeEntry('scroll' as LibraryKind, [scroll('s1', 'Ancient scroll', 25), scroll('s2', 'Bright scroll', 45)], {
    module: 'scroll',
    remove: (id: string) => {
      removed.push(id);
      return Promise.resolve(null);
    },
  });

  const registry = [fakeEntry('runestone', [row('runestone', 'a', 35)]), fourth];

  it('lists alongside the kinds that already existed', async () => {
    const { items, failed } = await loadLibrary(registry, QUERY);
    expect(items.map((item) => item.id)).toEqual(['s2', 'a', 's1']);
    expect(failed).toEqual([]);
  });

  it('filters and sorts by the same rules', async () => {
    const { items } = await loadLibrary(registry, QUERY);

    const onlyScrolls = filterItems(items, { kind: 'scroll' as LibraryKind });
    expect(onlyScrolls.map((item) => item.id)).toEqual(['s2', 's1']);

    expect(filterItems(items, { q: 'ancient' }).map((item) => item.id)).toEqual(['s1']);
    expect(sortItems(items, 'name', 'asc').map((item) => item.name)).toEqual([
      'Ancient scroll',
      'Bright scroll',
      'runestone-a',
    ]);
  });

  it('deletes through its own entry', async () => {
    const { items } = await loadLibrary(registry, QUERY);
    const target = items.find((item) => item.id === 's1');
    const entry = entryFor(registry, target?.kind ?? ('scroll' as LibraryKind));

    await entry?.remove(target?.id ?? '');

    expect(removed).toEqual(['s1']);
  });

  it('is gated by its own capability, like every other kind', () => {
    const kinds = availableKinds(registry, (module) => module === 'scroll');
    expect(kinds.map((entry) => entry.kind)).toEqual(['scroll']);
  });
});

/**
 * The real registry, not a fake one. PLAN-21 predicted that a fourth document
 * type would be one entry and no page change; PLAN-19 then added Groot and this
 * is the evidence it held — every per-kind behaviour the page uses is reachable
 * through the entry alone.
 */
describe('the shipped registry', () => {
  it('carries one entry per document kind', () => {
    expect(LIBRARY_REGISTRY.map((entry) => entry.kind)).toEqual(['runestone', 'edda', 'groot']);
  });

  it('gives every kind a distinct label, capability and badge colour', () => {
    const labels = LIBRARY_REGISTRY.map((entry) => entry.label);
    const modules = LIBRARY_REGISTRY.map((entry) => entry.module);
    const tones = LIBRARY_REGISTRY.map((entry) => entry.tone);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(modules).size).toBe(modules.length);
    // The badge is only recognisable at a glance if no two kinds share a hue.
    expect(new Set(tones).size).toBe(tones.length);
  });

  it('wires every kind end to end', () => {
    for (const entry of LIBRARY_REGISTRY) {
      const item = {
        kind: entry.kind,
        id: 'abc123',
        name: 'Doc',
        slug: `doc-abc123`,
        authorDeviceId: null,
        sizeBytes: 1,
        createdAt: 0,
        modifiedAt: 0,
      };
      expect(entry.events).toEqual([`${entry.kind}.saved`, `${entry.kind}.deleted`]);
      expect(entry.editorRoute(item)).toContain('doc-abc123');
      expect(entry.newRoute.startsWith('/')).toBe(true);
      expect(typeof entry.list).toBe('function');
      expect(typeof entry.remove).toBe('function');
    }
  });
});
