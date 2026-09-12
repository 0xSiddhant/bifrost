import { describe, expect, it } from 'vitest';
import { filterItems, mergeItems, sortItems } from './select';
import type { LibraryItem, LibraryKind } from './types';

function item(partial: Partial<LibraryItem> & { id: string; kind: LibraryKind }): LibraryItem {
  return {
    name: partial.id,
    slug: `${partial.id}-slug`,
    authorDeviceId: 'device-a',
    sizeBytes: 100,
    createdAt: 1_000,
    modifiedAt: 1_000,
    ...partial,
  };
}

const stone = item({ kind: 'runestone', id: 'aaa111', name: 'Beta config', sizeBytes: 300, createdAt: 30, modifiedAt: 50 });
const manuscript = item({ kind: 'edda', id: 'bbb222', name: 'alpha notes', sizeBytes: 100, createdAt: 10, modifiedAt: 70, authorDeviceId: 'device-b' });
const sprout = item({ kind: 'groot', id: 'ccc333', name: 'Gamma deploy', sizeBytes: 200, createdAt: 20, modifiedAt: 60 });

const all = [stone, manuscript, sprout];
const names = (rows: LibraryItem[]) => rows.map((row) => row.name);

describe('mergeItems', () => {
  it('flattens per-kind lists into one', () => {
    expect(mergeItems([[stone], [manuscript], [sprout]])).toEqual(all);
  });

  it('survives a kind contributing nothing', () => {
    expect(mergeItems([[stone], [], [sprout]])).toEqual([stone, sprout]);
  });
});

describe('sortItems', () => {
  // Criterion 1: one shared sort across all three kinds, not three sorted
  // blocks stacked on each other.
  it('interleaves kinds under every sort, both directions', () => {
    expect(names(sortItems(all, 'name', 'asc'))).toEqual(['alpha notes', 'Beta config', 'Gamma deploy']);
    expect(names(sortItems(all, 'name', 'desc'))).toEqual(['Gamma deploy', 'Beta config', 'alpha notes']);

    expect(names(sortItems(all, 'created', 'asc'))).toEqual(['alpha notes', 'Gamma deploy', 'Beta config']);
    expect(names(sortItems(all, 'created', 'desc'))).toEqual(['Beta config', 'Gamma deploy', 'alpha notes']);

    expect(names(sortItems(all, 'modified', 'asc'))).toEqual(['Beta config', 'Gamma deploy', 'alpha notes']);
    expect(names(sortItems(all, 'modified', 'desc'))).toEqual(['alpha notes', 'Gamma deploy', 'Beta config']);

    expect(names(sortItems(all, 'size', 'asc'))).toEqual(['alpha notes', 'Gamma deploy', 'Beta config']);
    expect(names(sortItems(all, 'size', 'desc'))).toEqual(['Beta config', 'Gamma deploy', 'alpha notes']);
  });

  it('sorts names case-insensitively, like the servers lower(name)', () => {
    const rows = [item({ kind: 'edda', id: 'x', name: 'zeta' }), item({ kind: 'edda', id: 'y', name: 'Alpha' })];
    expect(names(sortItems(rows, 'name', 'asc'))).toEqual(['Alpha', 'zeta']);
  });

  it('breaks ties on id ascending, in both directions', () => {
    const older = item({ kind: 'edda', id: 'aaa', modifiedAt: 5 });
    const newer = item({ kind: 'edda', id: 'bbb', modifiedAt: 5 });
    expect(sortItems([newer, older], 'modified', 'desc').map((row) => row.id)).toEqual(['aaa', 'bbb']);
    expect(sortItems([newer, older], 'modified', 'asc').map((row) => row.id)).toEqual(['aaa', 'bbb']);
  });

  // Ids are only unique within a table, so two kinds can hold the same handle —
  // without the kind tiebreak the two rows could swap places between renders.
  it('breaks a shared id on kind, so ordering is stable', () => {
    const twinA = item({ kind: 'runestone', id: 'same01', modifiedAt: 5 });
    const twinB = item({ kind: 'edda', id: 'same01', modifiedAt: 5 });
    expect(sortItems([twinA, twinB], 'modified', 'desc').map((row) => row.kind)).toEqual(['edda', 'runestone']);
    expect(sortItems([twinB, twinA], 'modified', 'desc').map((row) => row.kind)).toEqual(['edda', 'runestone']);
  });

  it('does not mutate its input', () => {
    const rows = [...all];
    sortItems(rows, 'name', 'asc');
    expect(rows).toEqual(all);
  });
});

describe('filterItems', () => {
  it('filters by kind — the one filter no server can apply', () => {
    expect(filterItems(all, { kind: 'edda' })).toEqual([manuscript]);
    expect(filterItems(all, { kind: null })).toEqual(all);
    expect(filterItems(all, {})).toEqual(all);
  });

  it('matches q case-insensitively on the name, as SQLite LIKE does', () => {
    expect(names(filterItems(all, { q: 'ALPHA' }))).toEqual(['alpha notes']);
    expect(names(filterItems(all, { q: '  beta ' }))).toEqual(['Beta config']);
    expect(filterItems(all, { q: 'nothing here' })).toEqual([]);
  });

  it('matches author on the exact deviceId', () => {
    expect(names(filterItems(all, { author: 'device-b' }))).toEqual(['alpha notes']);
    expect(filterItems(all, { author: 'device-missing' })).toEqual([]);
  });

  // Criterion 3: the three filters compose across types.
  it('composes q, author and kind', () => {
    expect(filterItems(all, { q: 'a', author: 'device-a', kind: 'groot' })).toEqual([sprout]);
    // Same query, wrong kind — composition is an AND, not a union.
    expect(filterItems(all, { q: 'a', author: 'device-a', kind: 'edda' })).toEqual([]);
  });
});
