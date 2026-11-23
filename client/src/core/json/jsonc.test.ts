import { describe, expect, it } from 'vitest';
import {
  FORMAT_FILE,
  asJsonFormat,
  docRanges,
  formatJson,
  jsonStats,
  minifyJson,
  parseJsonValue,
  pathAt,
  sortJsonKeys,
  sortKeysDeep,
  toStrictJson,
  validateJson,
} from './index';

/**
 * JSONC (PLAN-42): comments and trailing commas, and nothing else beyond
 * JSON. Strict JSON's own behaviour is pinned by `json.test.ts`, untouched.
 */

const SETTINGS = [
  '{',
  '  // Where the bridge listens',
  '  "port": 4646, // the default',
  '  /* the household name */ "name": "bifrost",',
  '  "big": 9007199254740993,',
  '  "ratio": 1.50,',
  '  "url": "http://bifrost.local/*not-a-comment*/",',
  '  "path": "C://not/a/comment",',
  '  "list": [1, 2, 3,],',
  '}',
].join('\n');

/** Every comment in a document, by the scanner — so strings never count. */
function commentsOf(text: string): string[] {
  const out: string[] = [];
  const re = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  for (const match of text.matchAll(re)) {
    if (!match[0].startsWith('"')) out.push(match[0]);
  }
  return out.sort();
}

describe('validateJson in JSONC', () => {
  it('accepts both comment styles and trailing commas in objects and arrays', () => {
    expect(validateJson(SETTINGS, 'jsonc')).toEqual([]);
    expect(validateJson('[1, 2,]', 'jsonc')).toEqual([]);
    expect(validateJson('{"a": {"b": 1,},}', 'jsonc')).toEqual([]);
    expect(validateJson('// a header\n{"a": 1}\n/* a footer */', 'jsonc')).toEqual([]);
  });

  it('leaves strict JSON rejecting what JSONC accepts', () => {
    expect(validateJson(SETTINGS).length).toBeGreaterThan(0);
    expect(validateJson(SETTINGS, 'json').length).toBeGreaterThan(0);
    expect(validateJson('[1, 2,]', 'json').length).toBeGreaterThan(0);
  });

  it('rejects every JSON5-only construct', () => {
    for (const doc of [
      "{'a': 1}",
      '{a: 1}',
      '{"a": NaN}',
      '{"a": Infinity}',
      '{"a": undefined}',
      '{"a": 0x1F}',
      '{"a": +1}',
      '{"a": .5}',
      '{"a": "line\\\ncontinued"}',
    ]) {
      expect(validateJson(doc, 'jsonc').length, doc).toBeGreaterThan(0);
    }
  });

  it('rejects malformed commas and comments with usable offsets', () => {
    const doubled = '{"a": 1,, "b": 2}';
    expect(validateJson(doubled, 'jsonc')[0]?.offset).toBe(doubled.indexOf(',,') + 1);
    expect(validateJson('[,]', 'jsonc').length).toBeGreaterThan(0);
    const open = '{"a": 1} /* never closed';
    const [issue] = validateJson(open, 'jsonc');
    expect(issue?.offset).toBe(open.indexOf('/*'));
    expect(issue?.message).toBe('Unterminated comment');
  });

  it('flags an empty or comment-only document', () => {
    expect(validateJson('', 'jsonc').length).toBeGreaterThan(0);
    expect(validateJson('// nothing here', 'jsonc').length).toBeGreaterThan(0);
  });
});

describe('reading JSONC values', () => {
  it('parses to the value JSON.parse gives the commentless document', () => {
    expect(parseJsonValue(SETTINGS, 'jsonc')).toEqual({
      port: 4646,
      name: 'bifrost',
      // The parsed value rounds past 2^53, exactly as JSON.parse does.
      big: JSON.parse('9007199254740993') as number,
      ratio: 1.5,
      url: 'http://bifrost.local/*not-a-comment*/',
      path: 'C://not/a/comment',
      list: [1, 2, 3],
    });
  });

  it('keeps JSON.parse semantics for duplicate and __proto__ keys', () => {
    const value = parseJsonValue('{"a": 1, "a": 2, "__proto__": {"x": 1}, // c\n}', 'jsonc');
    expect(value).toEqual(JSON.parse('{"a": 2, "__proto__": {"x": 1}}'));
    expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(true);
  });

  it('reads strict JSON in JSONC without the token walk, to the same value', () => {
    const doc = JSON.stringify({ rows: Array.from({ length: 20000 }, (_, i) => ({ i, s: `v${i}` })) });
    const start = performance.now();
    const value = parseJsonValue(doc, 'jsonc');
    const elapsed = performance.now() - start;
    expect(value).toEqual(JSON.parse(doc));
    // JSON.parse alone; the JSONC walk over the same text takes many times longer.
    const walkStart = performance.now();
    toStrictJson(doc);
    const walk = performance.now() - walkStart;
    expect(elapsed).toBeLessThan(walk);
  });

  it('is undefined for invalid text in either format', () => {
    expect(parseJsonValue('{"a": 1,}')).toBeUndefined();
    expect(parseJsonValue('{"a": }', 'jsonc')).toBeUndefined();
  });

  it('counts stats over JSONC and leaves comments out of the nodes', () => {
    const stats = jsonStats('{\n  // c\n  "a": [1, 2,],\n}', 'jsonc');
    expect(stats).toMatchObject({ valid: true, nodes: 4, depth: 3, lines: 4 });
    expect(jsonStats('{"a": 1,}').valid).toBe(false);
  });

  it('resolves paths and ranges past comments', () => {
    expect(pathAt(SETTINGS, SETTINGS.indexOf('4646'))).toBe('port');
    expect(pathAt(SETTINGS, SETTINGS.indexOf('3,]'))).toBe('list[2]');
    const range = docRanges(SETTINGS, 'jsonc').rangeAt(['name'], true);
    expect(SETTINGS.slice(range?.offset, (range?.offset ?? 0) + (range?.length ?? 0))).toBe(
      '"name": "bifrost"',
    );
  });
});

describe('JSONC transforms keep every comment', () => {
  it('formats without moving or dropping a comment or a trailing comma', () => {
    const pretty = formatJson('{"a":1,// one\n"b":[1,2,],/* two */"c":9007199254740993,}');
    expect(commentsOf(pretty)).toEqual(['/* two */', '// one']);
    expect(pretty).toContain('9007199254740993');
    expect(pretty).toContain('2,\n');
    expect(validateJson(pretty, 'jsonc')).toEqual([]);
    expect(parseJsonValue(pretty, 'jsonc')).toEqual({ a: 1, b: [1, 2], c: 2 ** 53 });
  });

  it('minifies but keeps comments, breaking the line after a line comment', () => {
    const small = minifyJson(SETTINGS, 'jsonc');
    expect(commentsOf(small)).toEqual(commentsOf(SETTINGS));
    expect(small).toContain('// the default\n"name"'.replace('"name"', '/* the household name */'));
    expect(validateJson(small, 'jsonc')).toEqual([]);
    expect(parseJsonValue(small, 'jsonc')).toEqual(parseJsonValue(SETTINGS, 'jsonc'));
    // The strings that only look like comments are untouched.
    expect(small).toContain('"http://bifrost.local/*not-a-comment*/"');
    expect(small).toContain('"C://not/a/comment"');
  });

  it('never lets a line comment swallow the token after it', () => {
    expect(minifyJson('[1, // one\n 2]', 'jsonc')).toBe('[1,// one\n2]');
    expect(minifyJson('{"a": 1}\n// end', 'jsonc')).toBe('{"a":1}// end');
    expect(minifyJson('[1, /* one */ 2]', 'jsonc')).toBe('[1,/* one */2]');
  });

  it('round-trips minify and format to the same value and comments', () => {
    const again = formatJson(minifyJson(SETTINGS, 'jsonc'));
    expect(commentsOf(again)).toEqual(commentsOf(SETTINGS));
    expect(parseJsonValue(again, 'jsonc')).toEqual(parseJsonValue(SETTINGS, 'jsonc'));
  });
});

describe('toStrictJson', () => {
  it('drops comments and trailing commas and keeps every raw token', () => {
    const strict = toStrictJson(SETTINGS);
    expect(strict).not.toBeNull();
    expect(validateJson(strict ?? '')).toEqual([]);
    expect(strict).toContain('9007199254740993');
    expect(strict).toContain('1.50');
    expect(strict).toContain('"http://bifrost.local/*not-a-comment*/"');
    expect(strict).toContain('"C://not/a/comment"');
    expect(strict).not.toMatch(/\/\/ |\/\* the/);
    expect(strict).toBe(
      [
        '{',
        '  "port": 4646,',
        '  "name": "bifrost",',
        '  "big": 9007199254740993,',
        '  "ratio": 1.50,',
        '  "url": "http://bifrost.local/*not-a-comment*/",',
        '  "path": "C://not/a/comment",',
        '  "list": [1, 2, 3]',
        '}',
      ].join('\n'),
    );
  });

  it('removes a comment between a value and its comma without leaving a gap', () => {
    expect(toStrictJson('{"a": 1 /* x */, "b": [ /* y */ 2 ]}')).toBe('{"a": 1, "b": [ 2 ]}');
  });

  it('removes a line of several comments whole, and the spaces a removal leaves', () => {
    expect(toStrictJson('{\n  /* a */ /* b */\n  "x": 1\n}')).toBe('{\n  "x": 1\n}');
    expect(toStrictJson('{\n  "x": 1 /* a */ // b\n}')).toBe('{\n  "x": 1\n}');
    expect(toStrictJson('[1, 2, ]')).toBe('[1, 2]');
    expect(toStrictJson('{"a" /* key */ : 1}')).toBe('{"a": 1}');
    expect(toStrictJson('{\n  /* spans\n     lines */\n  "x": 1\n}')).toBe('{\n  "x": 1\n}');
  });

  it('passes strict JSON through byte for byte', () => {
    const doc = '{\n  "a": [1, 2.50, "x\\u0041"],\n  "b": null\n}';
    expect(toStrictJson(doc)).toBe(doc);
  });

  it('refuses text that is not valid JSONC', () => {
    expect(toStrictJson('{"a": NaN}')).toBeNull();
    expect(toStrictJson('// only a comment')).toBeNull();
    expect(toStrictJson('')).toBeNull();
  });
});

describe('sortJsonKeys', () => {
  it('keeps strict JSON on its parse → sort → stringify path', () => {
    expect(sortJsonKeys('{"b": 1, "a": [{"d": 2, "c": 3}]}')).toBe(
      JSON.stringify({ a: [{ c: 3, d: 2 }], b: 1 }, null, 2),
    );
    expect(sortJsonKeys('{"a": 1,}')).toBeNull();
  });

  it('moves each leading and same-line trailing comment with its member', () => {
    const sorted = sortJsonKeys(SETTINGS, 'jsonc');
    expect(sorted).not.toBeNull();
    const text = sorted ?? '';
    const lines = text.split('\n').map((line) => line.trim());
    const at = (needle: string) => lines.findIndex((line) => line.includes(needle));
    // Keys come out A→Z.
    const keys = ['"big"', '"list"', '"name"', '"path"', '"port"', '"ratio"', '"url"'];
    const order = keys.map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The leading line comment sits right above "port"; its trailing one on its line.
    expect(lines[at('"port"') - 1]).toBe('// Where the bridge listens');
    expect(lines[at('"port"')]).toBe('"port": 4646, // the default');
    // A leading block comment on the key's line stays on it.
    expect(lines[at('"name"')]).toBe('/* the household name */ "name": "bifrost",');
    // Raw tokens survive; comments are all still there.
    expect(text).toContain('9007199254740993');
    expect(text).toContain('1.50');
    expect(commentsOf(text)).toEqual(commentsOf(SETTINGS));
    expect(parseJsonValue(text, 'jsonc')).toEqual(sortKeysDeep(parseJsonValue(SETTINGS, 'jsonc')));
  });

  it('keeps a comment on the brace line at the top and a last-line one at the bottom', () => {
    const doc = '{ // settings\n  "b": 1,\n  "a": 2,\n  // end of settings\n}';
    expect(sortJsonKeys(doc, 'jsonc')).toBe(
      '{ // settings\n  "a": 2,\n  "b": 1,\n  // end of settings\n}',
    );
  });

  it('keeps a comment written before the comma with its value', () => {
    expect(sortJsonKeys('{"b": 1 /* one */, "a": 2}', 'jsonc')).toBe(
      '{\n  "a": 2,\n  "b": 1 /* one */\n}',
    );
  });

  it('sorts objects inside arrays and keeps array order and separators', () => {
    const doc = '[ /* first */ {"z": 1, "a": 2}, // second\n {"y": 3, "b": 4}, ]';
    const sorted = sortJsonKeys(doc, 'jsonc') ?? '';
    expect(parseJsonValue(sorted, 'jsonc')).toEqual([
      { a: 2, z: 1 },
      { b: 4, y: 3 },
    ]);
    expect(commentsOf(sorted)).toEqual(['/* first */', '// second']);
    expect(sorted.trimEnd().endsWith(',\n]')).toBe(true);
  });

  it('orders index-like keys as the strict sort does: by number, first', () => {
    const doc = '{"b": 1, "10": 2,\n  /* nine */ "9": 3, "a": {"2": 0, "1": 0, "z": 0}}';
    const strict = sortJsonKeys(doc.replace('/* nine */', ''), 'json') ?? '';
    const jsonc = sortJsonKeys(doc, 'jsonc') ?? '';
    const keyOrder = (text: string) => [...text.matchAll(/"([^"]+)":/g)].map((match) => match[1]);
    expect(keyOrder(jsonc)).toEqual(['9', '10', 'a', '1', '2', 'z', 'b']);
    expect(keyOrder(jsonc)).toEqual(keyOrder(strict));
    expect(jsonc).toContain('/* nine */ "9": 3');
  });

  it('handles empty containers and comment-only objects', () => {
    expect(sortJsonKeys('{}', 'jsonc')).toBe('{}');
    expect(sortJsonKeys('[]', 'jsonc')).toBe('[]');
    expect(commentsOf(sortJsonKeys('{ /* nothing yet */ }', 'jsonc') ?? '')).toEqual([
      '/* nothing yet */',
    ]);
  });

  it('refuses invalid JSONC', () => {
    expect(sortJsonKeys('{"a": NaN}', 'jsonc')).toBeNull();
  });

  // Generated documents with comments in every position a member can have
  // one: whatever the shape, the sort keeps every comment, every raw token and
  // the sorted value, or refuses.
  it('is faithful over random commented documents', () => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let n = 0;
    const comment = (): string => {
      n += 1;
      const roll = rng();
      if (roll < 0.15) return ` // c${n}\n`;
      if (roll < 0.3) return ` /* c${n} */ `;
      if (roll < 0.35) return `\n/* c${n}\nspans */\n`;
      return rng() < 0.5 ? ' ' : '\n';
    };
    const value = (depth: number): string => {
      const roll = rng();
      if (depth > 3 || roll < 0.35) {
        const leaf = rng();
        if (leaf < 0.3) return String(Math.floor(rng() * 1e6)) + (rng() < 0.3 ? '.50' : '');
        if (leaf < 0.6) return `"s${Math.floor(rng() * 100)}"`;
        return rng() < 0.5 ? 'true' : 'null';
      }
      const count = Math.floor(rng() * 4);
      const items: string[] = [];
      for (let i = 0; i < count; i += 1) {
        items.push(
          roll < 0.6
            ? `${comment()}${value(depth + 1)}${comment()}`
            : `${comment()}"k${Math.floor(rng() * 30)}"${comment()}:${comment()}${value(depth + 1)}${comment()}`,
        );
      }
      const trailing = count > 0 && rng() < 0.4 ? `,${comment()}` : comment();
      const [open, close] = roll < 0.6 ? ['[', ']'] : ['{', '}'];
      return `${open}${items.join(',')}${trailing}${close}`;
    };

    let sortedCount = 0;
    const refused: string[] = [];
    for (let i = 0; i < 300; i += 1) {
      const doc = `${comment()}${value(0)}${comment()}`;
      if (validateJson(doc, 'jsonc').length > 0) continue;
      const sorted = sortJsonKeys(doc, 'jsonc');
      if (sorted === null) {
        refused.push(doc);
        continue;
      }
      sortedCount += 1;
      expect(validateJson(sorted, 'jsonc'), doc).toEqual([]);
      expect(commentsOf(sorted), doc).toEqual(commentsOf(doc));
      expect(JSON.stringify(parseJsonValue(sorted, 'jsonc')), doc).toBe(
        JSON.stringify(sortKeysDeep(parseJsonValue(doc, 'jsonc'))),
      );
      // Idempotent: sorting a sorted document changes nothing.
      expect(sortJsonKeys(sorted, 'jsonc'), doc).toBe(sorted);
    }
    // The generator really exercised the sort, and no valid document was refused.
    expect(refused).toEqual([]);
    expect(sortedCount).toBeGreaterThan(200);
  });
});

describe('format metadata', () => {
  it('maps each format to its file extension and media type', () => {
    expect(FORMAT_FILE.json).toMatchObject({ extension: '.json', mimeType: 'application/json' });
    expect(FORMAT_FILE.jsonc).toMatchObject({ extension: '.jsonc', mimeType: 'application/jsonc' });
  });

  it('reads anything unknown as strict JSON', () => {
    expect(asJsonFormat('jsonc')).toBe('jsonc');
    expect(asJsonFormat('json')).toBe('json');
    expect(asJsonFormat(undefined)).toBe('json');
    expect(asJsonFormat('JSON5')).toBe('json');
  });
});
