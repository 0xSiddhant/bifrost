import { describe, expect, it } from 'vitest';
import { sortKeysDeep } from './index';
import {
  diffJson,
  matchesPathGlob,
  type DiffOptions,
  type DiffRecord,
  type PathSegment,
} from './diff';

describe('diffJson basics', () => {
  it('reports nothing for equal documents', () => {
    const doc = { a: 1, b: [1, 2, { c: 'x' }], d: null };
    expect(diffJson(doc, doc)).toEqual([]);
    expect(diffJson(doc, JSON.parse(JSON.stringify(doc)))).toEqual([]);
  });

  it('reports a primitive change with its path and both values', () => {
    const records = diffJson({ a: { b: 1 } }, { a: { b: 2 } });
    expect(records).toEqual([
      {
        op: 'change',
        path: ['a', 'b'],
        leftPath: ['a', 'b'],
        rightPath: ['a', 'b'],
        before: 1,
        after: 2,
      },
    ]);
  });

  it('reports added and removed keys', () => {
    const records = diffJson({ gone: 1, kept: 2 }, { kept: 2, born: 3 });
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.op === 'remove')).toMatchObject({
      path: ['gone'],
      before: 1,
      rightPath: null,
    });
    expect(records.find((r) => r.op === 'add')).toMatchObject({
      path: ['born'],
      after: 3,
      leftPath: null,
    });
  });

  it('reports a type change instead of descending', () => {
    const records = diffJson({ a: { deep: 1 } }, { a: [1, 2] });
    expect(records).toEqual([
      {
        op: 'type-change',
        path: ['a'],
        leftPath: ['a'],
        rightPath: ['a'],
        before: { deep: 1 },
        after: [1, 2],
      },
    ]);
  });

  it('diffs root-level primitives', () => {
    expect(diffJson(1, 2)).toMatchObject([{ op: 'change', path: [] }]);
    expect(diffJson(null, false)).toMatchObject([{ op: 'type-change', path: [] }]);
  });
});

describe('key order', () => {
  const left = { z: 1, a: { y: 2, b: 3 } };
  const right = { a: { b: 3, y: 2 }, z: 1 };

  it('shuffled keys are zero differences by default (acceptance 1)', () => {
    expect(diffJson(left, right)).toEqual([]);
  });

  it('reports order-only differences when ignoreKeyOrder is off', () => {
    const records = diffJson(left, right, { ignoreKeyOrder: false });
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.aspect === 'key-order')).toBe(true);
    expect(records[0]).toMatchObject({ op: 'change', before: ['y', 'b'], after: ['b', 'y'] });
  });
});

describe('array strategy: index (default)', () => {
  it('pairs by position and reports tail extras', () => {
    const records = diffJson({ items: [1, 2, 3] }, { items: [1, 9] });
    expect(records).toEqual([
      {
        op: 'change',
        path: ['items', 1],
        leftPath: ['items', 1],
        rightPath: ['items', 1],
        before: 2,
        after: 9,
      },
      {
        op: 'remove',
        path: ['items', 2],
        leftPath: ['items', 2],
        rightPath: null,
        before: 3,
      },
    ]);
  });

  it('a shifted array reports everything changed (the by-key contrast case)', () => {
    const left = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
    const right = [{ id: 2, v: 'b' }, { id: 1, v: 'a' }];
    expect(diffJson(left, right).length).toBeGreaterThan(1);
  });
});

describe('array strategy: by key field', () => {
  const options: DiffOptions = { arrayStrategy: { kind: 'key', field: 'id' } };

  it('move-only reorders are zero differences', () => {
    const left = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }];
    const right = [{ id: 3, v: 'c' }, { id: 1, v: 'a' }, { id: 2, v: 'b' }];
    expect(diffJson(left, right, options)).toEqual([]);
  });

  it('reports one modified + one added when positions shifted (acceptance 2)', () => {
    const left = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
    const right = [{ id: 9, v: 'new' }, { id: 2, v: 'B' }, { id: 1, v: 'a' }];
    const records = diffJson(left, right, options);
    expect(records).toHaveLength(2);
    const change = records.find((r) => r.op === 'change');
    // id 2 sat at left[1] and stayed at right[1]; its v changed.
    expect(change).toMatchObject({
      path: [1, 'v'],
      leftPath: [1, 'v'],
      rightPath: [1, 'v'],
      before: 'b',
      after: 'B',
    });
    expect(records.find((r) => r.op === 'add')).toMatchObject({
      path: [0],
      leftPath: null,
      rightPath: [0],
    });
  });

  it('rebases right paths when a matched element moved', () => {
    const left = [{ id: 'x', v: 1 }, { id: 'y', v: 2 }];
    const right = [{ id: 'y', v: 99 }, { id: 'x', v: 1 }];
    const records = diffJson(left, right, options);
    expect(records).toEqual([
      {
        op: 'change',
        path: [1, 'v'],
        leftPath: [1, 'v'],
        rightPath: [0, 'v'],
        before: 2,
        after: 99,
      },
    ]);
  });

  it('elements without the field fall back to set matching', () => {
    const left = [{ id: 1, v: 'a' }, 'loose'];
    const right = ['loose', { id: 1, v: 'a' }];
    expect(diffJson(left, right, options)).toEqual([]);
  });

  it('duplicate identities never pair with unrelated items', () => {
    const left = [{ id: 1, v: 'a' }, { id: 1, v: 'b' }];
    const right = [{ id: 1, v: 'b' }, { id: 1, v: 'a' }];
    expect(diffJson(left, right, options)).toEqual([]);
  });
});

describe('array strategy: as set', () => {
  const options: DiffOptions = { arrayStrategy: { kind: 'set' } };

  it('order-insensitive multiset compare', () => {
    expect(diffJson(['a', 'b', 'b'], ['b', 'a', 'b'], options)).toEqual([]);
  });

  it('respects multiplicity', () => {
    const records = diffJson(['a', 'a'], ['a'], options);
    expect(records).toMatchObject([{ op: 'remove', path: [1], before: 'a' }]);
  });

  it('reports adds for new members', () => {
    const records = diffJson(['a'], ['a', 'z'], options);
    expect(records).toMatchObject([{ op: 'add', path: [1], after: 'z' }]);
  });
});

describe('numeric tolerance & case folding', () => {
  it('epsilon treats near numbers as equal', () => {
    expect(diffJson({ v: 1.0 }, { v: 1.0000001 }, { epsilon: 1e-3 })).toEqual([]);
    expect(diffJson({ v: 1.0 }, { v: 1.1 }, { epsilon: 1e-3 })).toHaveLength(1);
    expect(diffJson({ v: 1.0 }, { v: 1.0000001 })).toHaveLength(1);
  });

  it('case-insensitive strings', () => {
    expect(diffJson({ s: 'Hello' }, { s: 'hello' }, { caseInsensitiveStrings: true })).toEqual([]);
    expect(diffJson({ s: 'Hello' }, { s: 'hello' })).toHaveLength(1);
  });
});

describe('ignore-path globs', () => {
  it('**.updatedAt suppresses timestamp-only changes (acceptance 7)', () => {
    const left = { a: { updatedAt: 1, v: 1 }, updatedAt: 2, items: [{ updatedAt: 3 }] };
    const right = { a: { updatedAt: 9, v: 1 }, updatedAt: 9, items: [{ updatedAt: 9 }] };
    expect(diffJson(left, right, { ignorePaths: ['**.updatedAt'] })).toEqual([]);
  });

  it('prunes whole subtrees, including adds and removes under them', () => {
    const left = { meta: { a: 1 }, keep: 1 };
    const right = { meta: { b: 2 }, keep: 2 };
    const records = diffJson(left, right, { ignorePaths: ['meta.**'] });
    expect(records).toMatchObject([{ op: 'change', path: ['keep'] }]);
  });

  it('bracket segment patterns match array elements', () => {
    const left = { items: [{ etag: 'a', v: 1 }, { etag: 'b', v: 2 }] };
    const right = { items: [{ etag: 'x', v: 1 }, { etag: 'y', v: 2 }] };
    expect(diffJson(left, right, { ignorePaths: ['items[*].etag'] })).toEqual([]);
  });
});

describe('matchesPathGlob corpus', () => {
  const cases: [PathSegment[], string, boolean][] = [
    [['a', 'b'], 'a.b', true],
    [['a', 'b'], 'a.*', true],
    [['a', 'b', 'c'], 'a.*', false],
    [['a', 'b', 'c'], 'a.**', true],
    [['a'], 'a.**', true],
    [['x', 'deep', 'updatedAt'], '**.updatedAt', true],
    [['updatedAt'], '**.updatedAt', true],
    [['updatedAtx'], '**.updatedAt', false],
    [['items', 3, 'price'], 'items[3].price', true],
    [['items', 3, 'price'], 'items[*].price', true],
    [['items', 3, 'price'], 'items.3.price', true],
    [['items', 3], 'items[*].price', false],
    [[], '**', true],
    [['a'], '*', true],
    [[], '*', false],
  ];
  for (const [path, pattern, expected] of cases) {
    it(`${JSON.stringify(path)} vs "${pattern}" → ${expected}`, () => {
      expect(matchesPathGlob(path, pattern)).toBe(expected);
    });
  }
});

describe('property tests', () => {
  let seed = 1337;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const randomValue = (depth: number): unknown => {
    const roll = rng();
    if (depth >= 3 || roll < 0.35) {
      const prim = rng();
      if (prim < 0.25) return Math.floor(rng() * 1000) / 10;
      if (prim < 0.5) return `s${Math.floor(rng() * 100)}`;
      if (prim < 0.7) return rng() < 0.5;
      return null;
    }
    if (roll < 0.6) {
      return Array.from({ length: Math.floor(rng() * 4) }, () => randomValue(depth + 1));
    }
    const obj: Record<string, unknown> = {};
    const size = Math.floor(rng() * 5);
    for (let i = 0; i < size; i += 1) obj[`k${Math.floor(rng() * 50)}`] = randomValue(depth + 1);
    return obj;
  };

  it('diff(a, a) is empty over random documents', () => {
    for (let round = 0; round < 200; round += 1) {
      const doc = randomValue(0);
      expect(diffJson(doc, JSON.parse(JSON.stringify(doc)))).toEqual([]);
    }
  });

  /** Collect every mutable location (object key / array index) in a doc. */
  const sites = (value: unknown, path: PathSegment[], out: PathSegment[][]): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        out.push([...path, index]);
        sites(child, [...path, index], out);
      });
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        out.push([...path, key]);
        sites(child, [...path, key], out);
      }
    }
  };

  const mutate = (doc: unknown): unknown => {
    const copy: unknown = JSON.parse(JSON.stringify(doc));
    const all: PathSegment[][] = [];
    sites(copy, [], all);
    const mutations = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < mutations; i += 1) {
      if (all.length === 0) break;
      const site = all[Math.floor(rng() * all.length)];
      if (!site) break;
      let parent: unknown = copy;
      for (const seg of site.slice(0, -1)) {
        parent = (parent as Record<string, unknown>)[seg as string];
      }
      const last = site[site.length - 1];
      const container = parent as Record<string, unknown> & unknown[];
      const action = rng();
      if (action < 0.4) {
        container[last as string] = randomValue(2); // change / type-change
      } else if (action < 0.7 && typeof last === 'string') {
        delete container[last]; // remove an object key
      } else if (Array.isArray(container)) {
        container.push(randomValue(2)); // append → add
      } else {
        container[`fresh${Math.floor(rng() * 30)}`] = randomValue(2); // new key
      }
      // Mutations can invalidate previously collected sites — recollect.
      all.length = 0;
      sites(copy, [], all);
    }
    return copy;
  };

  /** Apply diff records back onto the left doc (index strategy invariants). */
  const applyRecords = (left: unknown, records: DiffRecord[]): unknown => {
    const root: { value: unknown } = { value: JSON.parse(JSON.stringify(left ?? null)) };
    const parentOf = (path: PathSegment[]): Record<string, unknown> & unknown[] => {
      let cur: unknown = root.value;
      for (const seg of path.slice(0, -1)) {
        cur = (cur as Record<string, unknown>)[seg as string];
      }
      return cur as Record<string, unknown> & unknown[];
    };
    const setAt = (path: PathSegment[], value: unknown): void => {
      if (path.length === 0) {
        root.value = value;
        return;
      }
      parentOf(path)[path[path.length - 1] as string] = value;
    };
    for (const r of records.filter((x) => x.op === 'change' || x.op === 'type-change')) {
      setAt(r.path, r.after);
    }
    const tailIndex = (r: DiffRecord): number => {
      const last = r.path[r.path.length - 1];
      return typeof last === 'number' ? last : -1;
    };
    const removes = records
      .filter((x) => x.op === 'remove')
      .sort((a, b) => b.path.length - a.path.length || tailIndex(b) - tailIndex(a));
    for (const r of removes) {
      const parent = parentOf(r.path);
      const last = r.path[r.path.length - 1];
      if (Array.isArray(parent)) parent.splice(last as number, 1);
      else delete parent[last as string];
    }
    for (const r of records.filter((x) => x.op === 'add')) {
      setAt(r.path, r.after);
    }
    return root.value;
  };

  it('applying the records to the left doc reproduces the right doc', () => {
    for (let round = 0; round < 200; round += 1) {
      const a = randomValue(0);
      const b = mutate(a);
      const records = diffJson(a, b);
      const rebuilt = applyRecords(a, records);
      expect(sortKeysDeep(rebuilt)).toEqual(sortKeysDeep(b));
      expect(diffJson(rebuilt, b)).toEqual([]);
    }
  });
});
