import { describe, expect, it } from 'vitest';
import { scanJs } from './scan';
import { stripComments } from './comments';
import { unwrapIife, wrapIife } from './iife';
import { curlToFetch, tokenizeShell } from './curl';
import { jsonToJs } from './jsonToJs';

/** Deterministic PRNG (shared shape with strings.test). */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('scanJs', () => {
  it('classifies strings, templates, comments, and regex', () => {
    const code = `const s = "a"; /* c */ const r = /x\\/y/g; // line\nconst t = \`hi\`;`;
    const kinds = scanJs(code).map((s) => s.type);
    expect(kinds).toContain('string');
    expect(kinds).toContain('block-comment');
    expect(kinds).toContain('regex');
    expect(kinds).toContain('line-comment');
    expect(kinds).toContain('template');
  });

  it('treats division as code, not regex', () => {
    const code = 'const x = a / b / c;';
    expect(scanJs(code).every((s) => s.type !== 'regex')).toBe(true);
  });

  it('covers the whole input contiguously', () => {
    const code = 'a = "x" + /y/ + `z`; // done';
    const segs = scanJs(code);
    let cursor = 0;
    for (const s of segs) {
      expect(s.start).toBe(cursor);
      cursor = s.end;
    }
    expect(cursor).toBe(code.length);
  });
});

describe('stripComments', () => {
  it('removes line and block comments', () => {
    expect(stripComments('a; // gone\nb; /* also */ c;')).toBe('a;\nb;   c;');
  });

  it('preserves comment-like text inside strings and regex', () => {
    expect(stripComments('const s = "http://x"; const r = /a\\/\\/b/;')).toBe(
      'const s = "http://x"; const r = /a\\/\\/b/;',
    );
  });

  it('collapses a multi-line block comment to a newline', () => {
    expect(stripComments('a;/*\nx\ny\n*/b;')).toBe('a;\nb;');
  });
});

describe('wrapIife / unwrapIife', () => {
  it('round-trips arbitrary source', () => {
    const rng = mulberry32(7);
    const lines = ['const a = 1;', '  indented();', '', 'return a;', 'if (x) {', '  y();', '}'];
    for (let i = 0; i < 200; i += 1) {
      const count = 1 + Math.floor(rng() * lines.length);
      const code = Array.from({ length: count }, () => lines[Math.floor(rng() * lines.length)]).join(
        '\n',
      );
      expect(unwrapIife(wrapIife(code))).toBe(code);
    }
  });

  it('produces a runnable IIFE shape', () => {
    expect(wrapIife('doThing();')).toBe('(() => {\n  doThing();\n})();');
  });

  it('leaves non-IIFE input unchanged when unwrapping', () => {
    expect(unwrapIife('const a = 1;')).toBe('const a = 1;');
  });

  it('unwraps a classic function IIFE', () => {
    expect(unwrapIife('(function () {\n  run();\n})();')).toBe('run();');
  });
});

describe('tokenizeShell', () => {
  it('honours quotes and line continuations', () => {
    expect(tokenizeShell(`curl -H 'a: b' \\\n  "http://x/y"`)).toEqual([
      'curl',
      '-H',
      'a: b',
      'http://x/y',
    ]);
  });
});

describe('curlToFetch', () => {
  it('translates method, headers, and body', () => {
    const { code } = curlToFetch(
      `curl -X POST https://api.test/v1 -H 'Content-Type: application/json' -d '{"a":1}'`,
    );
    expect(code).toContain("fetch('https://api.test/v1'");
    expect(code).toContain("method: 'POST'");
    expect(code).toContain("'Content-Type': 'application/json'");
    expect(code).toContain(`body: '{"a":1}'`);
  });

  it('defaults to GET with no body and POST with a body', () => {
    expect(curlToFetch('curl https://x').code).toContain("method: 'GET'");
    expect(curlToFetch('curl https://x -d hi').code).toContain("method: 'POST'");
  });

  it('reports unsupported flags instead of dropping them', () => {
    const { unsupported } = curlToFetch('curl --cacert ./ca.pem https://x');
    expect(unsupported).toContain('--cacert');
  });

  it('converts basic auth to an Authorization header', () => {
    expect(curlToFetch('curl -u user:pass https://x').code).toContain('Authorization');
  });
});

describe('jsonToJs', () => {
  const runAsJs = (js: string): unknown => new Function(`return (${js});`)() as unknown;

  it('unquotes identifier keys and quotes the rest (demo D/E)', () => {
    const out = jsonToJs('{"name":"Bob","data-id":"x","valid":true}');
    expect(out).toContain('name: ');
    expect(out).toContain("'data-id': ");
    expect(out).toContain("'Bob'");
  });

  it('round-trips JSON → JS → value (property)', () => {
    const rng = mulberry32(99);
    const gen = (depth: number): unknown => {
      const roll = rng();
      if (depth > 3 || roll < 0.4) {
        const leafRoll = rng();
        if (leafRoll < 0.3) return Math.floor(rng() * 1000);
        if (leafRoll < 0.5) return rng() < 0.5;
        if (leafRoll < 0.6) return null;
        return `s${Math.floor(rng() * 100)}'"\\`;
      }
      if (roll < 0.7) {
        return Array.from({ length: Math.floor(rng() * 4) }, () => gen(depth + 1));
      }
      const obj: Record<string, unknown> = {};
      const keys = ['a', 'data-id', '1x', 'valid_$', '', 'with space'];
      for (const k of keys) if (rng() < 0.5) obj[k] = gen(depth + 1);
      return obj;
    };
    for (let i = 0; i < 300; i += 1) {
      const value = gen(0);
      const json = JSON.stringify(value);
      expect(runAsJs(jsonToJs(json))).toEqual(value);
    }
  });

  it('handles empty containers', () => {
    expect(jsonToJs('{}')).toBe('{}');
    expect(jsonToJs('[]')).toBe('[]');
  });
});
