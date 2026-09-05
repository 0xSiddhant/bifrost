import { describe, expect, it } from 'vitest';
import { diffJson, type PathSegment } from './diff';
import {
  applyJsonPatch,
  JsonPatchError,
  toJsonPatch,
  toJsonPointer,
  type JsonPatchOp,
} from './jsonPatch';

/** The round trip the export flow itself runs before offering a download. */
const roundTrip = (left: unknown, right: unknown): unknown =>
  applyJsonPatch(left, toJsonPatch(diffJson(left, right)));

describe('toJsonPointer escaping (RFC 6901)', () => {
  it('escapes ~ as ~0 and / as ~1, per segment', () => {
    expect(toJsonPointer(['a/b'])).toBe('/a~1b');
    expect(toJsonPointer(['~config'])).toBe('/~0config');
    expect(toJsonPointer(['~/both'])).toBe('/~0~1both');
    expect(toJsonPointer(['outer', 'a/b', 0, 'c~d'])).toBe('/outer/a~1b/0/c~0d');
  });

  it('renders the root path as the empty pointer, not "/"', () => {
    expect(toJsonPointer([])).toBe('');
  });

  it('round-trips keys containing / and ~ through a real patch (acceptance 2)', () => {
    const left = { 'a/b': 1, '~config': { 'x~/y': 'old' }, plain: 1 };
    const right = { 'a/b': 2, '~config': { 'x~/y': 'new' }, plain: 1 };
    const ops = toJsonPatch(diffJson(left, right));
    expect(ops.map((op) => op.path)).toEqual(['/a~1b', '/~0config/x~0~1y']);
    expect(applyJsonPatch(left, ops)).toEqual(right);
  });
});

describe('toJsonPatch op mapping', () => {
  it('maps an added key to add', () => {
    expect(toJsonPatch(diffJson({ a: 1 }, { a: 1, b: 2 }))).toEqual([
      { op: 'add', path: '/b', value: 2 },
    ]);
  });

  it('maps a dropped key to remove', () => {
    expect(toJsonPatch(diffJson({ a: 1, b: 2 }, { a: 1 }))).toEqual([{ op: 'remove', path: '/b' }]);
  });

  it('maps a changed value to replace', () => {
    expect(toJsonPatch(diffJson({ a: 1 }, { a: 2 }))).toEqual([
      { op: 'replace', path: '/a', value: 2 },
    ]);
  });

  it('maps a type change to replace — RFC 6902 has no separate concept', () => {
    expect(toJsonPatch(diffJson({ a: 1 }, { a: '1' }))).toEqual([
      { op: 'replace', path: '/a', value: '1' },
    ]);
  });

  it('drops key-order records — JSON objects are unordered (acceptance 3)', () => {
    const left = { b: 1, a: 2 };
    const right = { a: 2, b: 1 };
    const records = diffJson(left, right, { ignoreKeyOrder: false });
    expect(records).toHaveLength(1);
    expect(records[0]?.aspect).toBe('key-order');
    expect(toJsonPatch(records)).toEqual([]);
  });
});

describe('sequential array removes', () => {
  it('orders removes in one array highest-index-first (acceptance 4)', () => {
    const left = { items: ['a', 'b', 'c', 'd', 'e'] };
    const right = { items: ['a', 'b'] };
    const ops = toJsonPatch(diffJson(left, right));
    expect(ops).toEqual([
      { op: 'remove', path: '/items/4' },
      { op: 'remove', path: '/items/3' },
      { op: 'remove', path: '/items/2' },
    ]);
    // Applied in file order, which is the only order a consumer will use.
    expect(applyJsonPatch(left, ops)).toEqual(right);
  });

  it('would corrupt the document in the walker-emitted ascending order', () => {
    // Guards the fix rather than the symptom: the ascending sequence the
    // walker emits is genuinely wrong, so the reordering is load-bearing.
    const left = { items: ['a', 'b', 'c', 'd', 'e'] };
    const ascending: JsonPatchOp[] = [
      { op: 'remove', path: '/items/2' },
      { op: 'remove', path: '/items/3' },
      { op: 'remove', path: '/items/4' },
    ];
    expect(() => applyJsonPatch(left, ascending)).toThrow(JsonPatchError);
  });

  it('sorts each array independently, leaving other records where they were', () => {
    const left = { one: [1, 2, 3], two: ['x', 'y', 'z'], flag: true };
    const right = { one: [1], two: ['x'], flag: false };
    const ops = toJsonPatch(diffJson(left, right));
    // Records arrive in the walker's canonical (key-sorted) order; only each
    // array's own removes are permuted, and only among themselves.
    expect(ops).toEqual([
      { op: 'replace', path: '/flag', value: false },
      { op: 'remove', path: '/one/2' },
      { op: 'remove', path: '/one/1' },
      { op: 'remove', path: '/two/2' },
      { op: 'remove', path: '/two/1' },
    ]);
    expect(applyJsonPatch(left, ops)).toEqual(right);
  });

  it('leaves a lone object-key remove untouched', () => {
    expect(toJsonPatch(diffJson({ a: 1, b: 2 }, { b: 2 }))).toEqual([{ op: 'remove', path: '/a' }]);
  });
});

describe('applyJsonPatch in isolation', () => {
  const doc = { name: 'bifrost', tags: ['a', 'b'], nested: { keep: 1, drop: 2 } };

  it('adds an object key and an array element', () => {
    expect(applyJsonPatch(doc, [{ op: 'add', path: '/version', value: 3 }])).toMatchObject({
      version: 3,
    });
    expect(applyJsonPatch(doc, [{ op: 'add', path: '/tags/1', value: 'mid' }])).toMatchObject({
      tags: ['a', 'mid', 'b'],
    });
    expect(applyJsonPatch(doc, [{ op: 'add', path: '/tags/-', value: 'end' }])).toMatchObject({
      tags: ['a', 'b', 'end'],
    });
  });

  it('removes at a nested path', () => {
    expect(applyJsonPatch(doc, [{ op: 'remove', path: '/nested/drop' }])).toEqual({
      name: 'bifrost',
      tags: ['a', 'b'],
      nested: { keep: 1 },
    });
  });

  it('replaces a whole subtree', () => {
    expect(
      applyJsonPatch(doc, [{ op: 'replace', path: '/nested', value: { fresh: true } }]),
    ).toMatchObject({ nested: { fresh: true } });
  });

  it('replaces the whole document at the root pointer', () => {
    expect(applyJsonPatch(doc, [{ op: 'replace', path: '', value: [1, 2] }])).toEqual([1, 2]);
  });

  it('never mutates the document it was handed', () => {
    const original = structuredClone(doc);
    applyJsonPatch(doc, [{ op: 'remove', path: '/nested/drop' }]);
    expect(doc).toEqual(original);
  });

  it('rejects operations that do not fit the document', () => {
    expect(() => applyJsonPatch(doc, [{ op: 'remove', path: '/missing' }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch(doc, [{ op: 'remove', path: '/tags/9' }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch(doc, [{ op: 'replace', path: '/name/deep', value: 1 }])).toThrow(
      JsonPatchError,
    );
    expect(() => applyJsonPatch(doc, [{ op: 'remove', path: '' }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch(doc, [{ op: 'add', path: 'no-slash', value: 1 }])).toThrow(
      JsonPatchError,
    );
  });
});

describe('multi-op fixture (acceptance 1)', () => {
  it('reproduces the right document from a real mixed diff', () => {
    const left = {
      service: 'heimdall',
      port: 8080,
      retries: 3,
      tags: ['lan', 'legacy', 'beta'],
      limits: { cpu: '500m', memory: '256Mi' },
    };
    const right = {
      service: 'heimdall',
      port: '8080',
      tags: ['lan'],
      limits: { cpu: '1000m', memory: '256Mi', disk: '1Gi' },
      owner: 'ops',
    };
    const ops = toJsonPatch(diffJson(left, right));
    // add, remove, replace and a type change all in one patch.
    expect(ops.map((op) => op.op).sort()).toEqual([
      'add',
      'add',
      'remove',
      'remove',
      'remove',
      'replace',
      'replace',
    ]);
    expect(applyJsonPatch(left, ops)).toEqual(right);
  });
});

describe('property tests', () => {
  // Same deterministic generator PLAN-08's own walker tests use.
  let seed = 20260905;
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
      return Array.from({ length: Math.floor(rng() * 5) }, () => randomValue(depth + 1));
    }
    const obj: Record<string, unknown> = {};
    const size = Math.floor(rng() * 5);
    for (let i = 0; i < size; i += 1) obj[`k${Math.floor(rng() * 50)}`] = randomValue(depth + 1);
    return obj;
  };

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

  /**
   * Deliberately unlike the walker's own mutate(): this one also **truncates
   * arrays**, which is the only way multiple removes land in one array — the
   * exact case the descending-remove ordering exists for.
   */
  const mutate = (doc: unknown): unknown => {
    const copy: unknown = structuredClone(doc);
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
      const container = parent as Record<string, unknown>;
      const action = rng();
      if (action < 0.3) {
        container[last as string] = randomValue(2);
      } else if (action < 0.5 && typeof last === 'string') {
        delete container[last];
      } else if (action < 0.75 && Array.isArray(parent) && parent.length > 0) {
        // Truncate: two or more trailing removes in the same array.
        parent.length = Math.floor(rng() * parent.length);
      } else if (Array.isArray(parent)) {
        parent.push(randomValue(2), randomValue(2));
      } else {
        container[`fresh${Math.floor(rng() * 30)}`] = randomValue(2);
      }
      all.length = 0;
      sites(copy, [], all);
    }
    return copy;
  };

  it('applying the generated patch to the left doc reproduces the right doc', () => {
    for (let round = 0; round < 300; round += 1) {
      const left = randomValue(0);
      const right = mutate(left);
      const rebuilt = roundTrip(left, right);
      // Key order is not a difference, so compare with the walker itself.
      expect(diffJson(rebuilt, right)).toEqual([]);
    }
  });
});
