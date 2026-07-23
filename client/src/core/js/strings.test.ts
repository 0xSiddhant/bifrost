import { describe, expect, it } from 'vitest';
import {
  convertQuotes,
  destringifyJs,
  htmlEscape,
  htmlUnescape,
  isSingleStringLiteral,
  stringifyJs,
  uriDecode,
  uriEncode,
  type QuoteStyle,
} from './strings';

/** Deterministic PRNG so "property" tests are reproducible. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [
  'a', 'B', '1', ' ', '\n', '\t', '\r', '\\', "'", '"', '`', '$', '{', '}',
  '<', '>', '&', '\0', '\v', 'é', '💥', '/', '\b', '\f',
];

function randomString(rng: () => number, maxLen: number): string {
  const len = Math.floor(rng() * maxLen);
  let s = '';
  for (let i = 0; i < len; i += 1) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return s;
}

describe('stringifyJs / destringifyJs', () => {
  it('round-trips arbitrary strings across every quote style', () => {
    const rng = mulberry32(42);
    const styles: QuoteStyle[] = ['single', 'double', 'backtick', 'json'];
    for (let i = 0; i < 500; i += 1) {
      const raw = randomString(rng, 30);
      for (const style of styles) {
        expect(destringifyJs(stringifyJs(raw, style))).toBe(raw);
      }
    }
  });

  it('wraps in the requested delimiter', () => {
    expect(stringifyJs('hi', 'single')).toBe("'hi'");
    expect(stringifyJs('hi', 'double')).toBe('"hi"');
    expect(stringifyJs('hi', 'backtick')).toBe('`hi`');
  });

  it('escapes only the active delimiter', () => {
    expect(stringifyJs('it\'s "ok"', 'single')).toBe("'it\\'s \"ok\"'");
    expect(stringifyJs('it\'s "ok"', 'double')).toBe('"it\'s \\"ok\\""');
  });

  it('keeps real newlines in template literals but escapes the interpolation', () => {
    expect(stringifyJs('a\n${b}', 'backtick')).toBe('`a\n\\${b}`');
  });

  it('destringify accepts surrounding whitespace', () => {
    expect(destringifyJs('   "hi"  ')).toBe('hi');
  });

  it('destringify decodes \\x and \\u escapes', () => {
    expect(destringifyJs('"\\x41\\u0042\\u{1F4A5}"')).toBe('AB💥');
  });

  it('destringify rejects non-literals', () => {
    expect(() => destringifyJs('hello')).toThrow();
    expect(() => destringifyJs('"unterminated')).toThrow();
    expect(() => destringifyJs('"a" + "b"')).toThrow();
  });
});

describe('isSingleStringLiteral', () => {
  it('is true for a whole-buffer quoted literal (any quote)', () => {
    expect(isSingleStringLiteral('"abc"')).toBe(true);
    expect(isSingleStringLiteral("  'abc'  ")).toBe(true);
    expect(isSingleStringLiteral('`abc`')).toBe(true);
  });

  it('is false for code, empty, or partial literals', () => {
    expect(isSingleStringLiteral('const a = 1;')).toBe(false);
    expect(isSingleStringLiteral('')).toBe(false);
    expect(isSingleStringLiteral('"a" + "b"')).toBe(false);
  });

  it('recognises the output of stringifyJs (so Stringify is not re-applied)', () => {
    expect(isSingleStringLiteral(stringifyJs('const a = 1;', 'double'))).toBe(true);
  });
});

describe('html + uri escapes', () => {
  it('round-trips html entities', () => {
    const raw = `<a href="x">Tom & Jerry's</a>`;
    expect(htmlUnescape(htmlEscape(raw))).toBe(raw);
  });

  it('escapes the five significant chars', () => {
    expect(htmlEscape('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('unescapes numeric and hex entities', () => {
    expect(htmlUnescape('&#65;&#x42;')).toBe('AB');
  });

  it('round-trips uri encoding', () => {
    const raw = 'a b/c?d=é&💥';
    expect(uriDecode(uriEncode(raw))).toBe(raw);
  });

  it('throws on malformed percent-encoding', () => {
    expect(() => uriDecode('%zz')).toThrow();
  });
});

describe('convertQuotes', () => {
  it('converts double to single, re-escaping', () => {
    expect(convertQuotes(`const a = "it's";`, 'single')).toBe(`const a = 'it\\'s';`);
  });

  it('converts single to double', () => {
    expect(convertQuotes(`const a = 'x';`, 'double')).toBe(`const a = "x";`);
  });

  it('leaves templates, regex, and comments untouched', () => {
    const code = 'const r = /a"b/; const t = `x"y`; // a "comment"\nconst s = "z";';
    expect(convertQuotes(code, 'single')).toBe(
      "const r = /a\"b/; const t = `x\"y`; // a \"comment\"\nconst s = 'z';",
    );
  });

  it('does not touch the other quote style', () => {
    expect(convertQuotes(`a = 'keep'; b = "change";`, 'single')).toBe(`a = 'keep'; b = 'change';`);
  });
});
