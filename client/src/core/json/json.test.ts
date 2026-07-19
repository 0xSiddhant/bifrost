import { describe, expect, it } from 'vitest';
import {
  formatJson,
  formatJsonPath,
  jsonStats,
  minifyJson,
  pathAt,
  sortKeysDeep,
  unescapeEmbedded,
  validateJson,
} from './index';

describe('validateJson', () => {
  it('accepts valid documents', () => {
    expect(validateJson('{"a": [1, 2.5, true, null], "b": "x"}')).toEqual([]);
  });

  it('reports every error, not just the first', () => {
    const issues = validateJson('{"a": , "b": tru, }');
    expect(issues.length).toBeGreaterThanOrEqual(2);
    for (const issue of issues) {
      expect(issue.offset).toBeGreaterThanOrEqual(0);
      expect(issue.length).toBeGreaterThanOrEqual(1);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it('flags trailing commas (strict JSON, not JSONC)', () => {
    expect(validateJson('{"a": 1,}').length).toBeGreaterThan(0);
    expect(validateJson('[1, 2,]').length).toBeGreaterThan(0);
  });

  it('flags comments', () => {
    expect(validateJson('{"a": 1} // note').length).toBeGreaterThan(0);
  });

  it('flags NaN and undefined literals', () => {
    expect(validateJson('{"a": NaN}').length).toBeGreaterThan(0);
    expect(validateJson('{"a": undefined}').length).toBeGreaterThan(0);
  });

  it('flags a BOM prefix', () => {
    expect(validateJson('﻿{"a": 1}').length).toBeGreaterThan(0);
  });

  it('flags nested errors with positions', () => {
    const doc = '{"outer": {"inner": [1, 2, }}';
    const issues = validateJson(doc);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.offset).toBeGreaterThan(20);
  });

  it('flags an empty document', () => {
    expect(validateJson('').length).toBeGreaterThan(0);
  });
});

describe('formatJson', () => {
  it('pretty-prints with 2-space indent', () => {
    expect(formatJson('{"a":1,"b":[true,null]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    );
  });

  it('preserves key order and raw number precision', () => {
    const doc = '{"z":1,"a":9007199254740993,"m":0.30000000000000004}';
    const pretty = formatJson(doc);
    expect(pretty.indexOf('"z"')).toBeLessThan(pretty.indexOf('"a"'));
    expect(pretty).toContain('9007199254740993');
    expect(pretty).toContain('0.30000000000000004');
  });
});

describe('minifyJson', () => {
  it('strips all inter-token whitespace', () => {
    expect(minifyJson('{\n  "a": [1, 2],\n  "b": "x y"\n}')).toBe('{"a":[1,2],"b":"x y"}');
  });

  it('preserves whitespace and escapes inside strings', () => {
    expect(minifyJson('{ "a": "one  two\\n" }')).toBe('{"a":"one  two\\n"}');
  });

  it('round-trips with formatJson', () => {
    const doc = '{"a":{"b":[1,"two",null,false]},"c":3.14}';
    expect(minifyJson(formatJson(doc))).toBe(doc);
  });
});

describe('sortKeysDeep', () => {
  it('sorts object keys recursively, leaving arrays in order', () => {
    const input = { b: { z: 1, a: 2 }, a: [{ y: 1, x: 2 }, 3] };
    expect(JSON.stringify(sortKeysDeep(input))).toBe('{"a":[{"x":2,"y":1},3],"b":{"a":2,"z":1}}');
  });

  it('passes primitives through', () => {
    expect(sortKeysDeep(null)).toBeNull();
    expect(sortKeysDeep(42)).toBe(42);
    expect(sortKeysDeep('x')).toBe('x');
  });

  // Property tests over generated documents: idempotent, value-preserving,
  // and every object's keys come out sorted. Seeded rng keeps runs stable.
  it('is idempotent and stable over random documents', () => {
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const randomValue = (depth: number): unknown => {
      const roll = rng();
      if (depth > 3 || roll < 0.3) {
        const leaf = rng();
        if (leaf < 0.25) return Math.floor(rng() * 1000);
        if (leaf < 0.5) return `s${Math.floor(rng() * 100)}`;
        if (leaf < 0.75) return rng() < 0.5;
        return null;
      }
      if (roll < 0.6) {
        return Array.from({ length: Math.floor(rng() * 4) }, () => randomValue(depth + 1));
      }
      const obj: Record<string, unknown> = {};
      for (let i = Math.floor(rng() * 5); i > 0; i -= 1) {
        obj[`k${Math.floor(rng() * 50)}`] = randomValue(depth + 1);
      }
      return obj;
    };

    const assertSorted = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(assertSorted);
      } else if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value);
        expect(keys).toEqual([...keys].sort());
        Object.values(value).forEach(assertSorted);
      }
    };

    for (let i = 0; i < 200; i += 1) {
      const doc = randomValue(0);
      const sorted = sortKeysDeep(doc);
      assertSorted(sorted);
      // idempotent
      expect(JSON.stringify(sortKeysDeep(sorted))).toBe(JSON.stringify(sorted));
      // value-preserving: same parse result modulo key order
      expect(sortKeysDeep(JSON.parse(JSON.stringify(doc)))).toEqual(sorted);
    }
  });
});

describe('unescapeEmbedded', () => {
  it('unwraps a JSON string containing JSON', () => {
    expect(unescapeEmbedded('"{\\"a\\":1}"')).toBe('{"a":1}');
  });

  it('peels multiple layers', () => {
    const inner = '{"a":1}';
    const once = JSON.stringify(inner);
    const twice = JSON.stringify(once);
    expect(unescapeEmbedded(twice)).toBe(inner);
  });

  it('returns null when there is nothing embedded', () => {
    expect(unescapeEmbedded('{"a": 1}')).toBeNull();
    expect(unescapeEmbedded('"just a sentence"')).toBeNull();
    expect(unescapeEmbedded('not json at all')).toBeNull();
  });
});

describe('jsonStats', () => {
  it('counts bytes, lines, nodes, and depth', () => {
    const stats = jsonStats('{\n  "a": [1, 2],\n  "b": null\n}');
    expect(stats.valid).toBe(true);
    expect(stats.lines).toBe(4);
    // root object + array + 2 numbers + null = 5 value nodes... plus string? none.
    expect(stats.nodes).toBe(5);
    expect(stats.depth).toBe(3); // root → array → number
    expect(stats.bytes).toBeGreaterThan(20);
  });

  it('reports invalid docs without crashing', () => {
    const stats = jsonStats('{"a": ');
    expect(stats.valid).toBe(false);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('handles the empty document', () => {
    expect(jsonStats('')).toEqual({ bytes: 0, lines: 0, nodes: 0, depth: 0, valid: false });
  });
});

describe('paths', () => {
  it('formats mixed key/index paths', () => {
    expect(formatJsonPath(['data', 'items', 3, 'price'])).toBe('data.items[3].price');
    expect(formatJsonPath([])).toBe('$');
    expect(formatJsonPath(['weird key', 0])).toBe('["weird key"][0]');
  });

  it('resolves the path at a document offset', () => {
    const doc = '{"data": {"items": [{"price": 9}]}}';
    expect(pathAt(doc, doc.indexOf('9'))).toBe('data.items[0].price');
  });
});
