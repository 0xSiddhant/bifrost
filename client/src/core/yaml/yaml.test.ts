import { describe, expect, it } from 'vitest';
import {
  MAX_ALIAS_COUNT,
  analyzeYaml,
  formatYaml,
  jsonToYaml,
  parseDocuments,
  toBlock,
  toFlow,
  validateYaml,
  yamlStats,
  yamlToJson,
} from './index';

describe('validateYaml', () => {
  it('accepts an empty document', () => {
    expect(validateYaml('')).toEqual([]);
    expect(validateYaml('   \n  ')).toEqual([]);
  });

  it('accepts an ordinary block mapping', () => {
    expect(validateYaml('name: bifrost\nport: 4646\n')).toEqual([]);
  });

  it('reports a tab used as indentation', () => {
    const issues = validateYaml('root:\n\tchild: 1\n');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('reports bad indentation', () => {
    const issues = validateYaml('a:\n  b: 1\n   c: 2\n');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('reports an unclosed flow collection', () => {
    const issues = validateYaml('a: [1, 2\n');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('does NOT report a duplicate key — that is an advisory, and it must stay savable', () => {
    expect(validateYaml('a: 1\na: 2\n')).toEqual([]);
  });

  it('honours a %YAML 1.1 directive — the Norway problem, live', () => {
    // The whole point of the boolish advisory: the same three characters are a
    // string under 1.2 and a boolean under 1.1, and the document decides.
    expect(parseDocuments('country: no\n')[0]!.value).toEqual({ country: 'no' });
    expect(parseDocuments('%YAML 1.1\n---\ncountry: no\n')[0]!.value).toEqual({
      country: false,
    });
    expect(validateYaml('%YAML 1.1\n---\ncountry: no\n')).toEqual([]);
  });

  it('carries an offset that lands inside the document', () => {
    const text = 'a: [1, 2\n';
    const [issue] = validateYaml(text);
    expect(issue).toBeDefined();
    expect(issue!.offset).toBeGreaterThanOrEqual(0);
    expect(issue!.offset).toBeLessThanOrEqual(text.length);
    expect(issue!.length).toBeGreaterThan(0);
    expect(issue!.message).not.toEqual('');
  });

  it('clears once the error is fixed', () => {
    expect(validateYaml('a: [1, 2\n')).not.toEqual([]);
    expect(validateYaml('a: [1, 2]\n')).toEqual([]);
  });
});

describe('the billion-laughs guard', () => {
  /** The classic bomb: nine aliases per level, expanding geometrically. */
  const bomb = [
    'a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]',
    'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
    'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
    'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
    'f: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e]',
    'g: &g [*f,*f,*f,*f,*f,*f,*f,*f,*f]',
    '',
  ].join('\n');

  it('refuses to expand it instead of hanging the tab', () => {
    const started = Date.now();
    const issues = validateYaml(bomb);
    // The guard is a count, so this returns in milliseconds, not never.
    expect(Date.now() - started).toBeLessThan(2000);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('leaves the document unresolved rather than half-expanded', () => {
    const [doc] = parseDocuments(bomb);
    expect(doc).toBeDefined();
    expect(doc!.value).toBeUndefined();
  });

  it('still resolves a document whose alias count is under the cap', () => {
    const modest = ['a: &a [1, 2]', 'b: [*a, *a, *a]', ''].join('\n');
    const [doc] = parseDocuments(modest);
    expect(doc!.value).toEqual({ a: [1, 2], b: [[1, 2], [1, 2], [1, 2]] });
    expect(MAX_ALIAS_COUNT).toBeGreaterThan(0);
  });
});

describe('formatYaml', () => {
  it('preserves every comment, in position', () => {
    const source = [
      '# the whole file',
      'server:',
      '    # why this port',
      '    port: 4646 # inline',
      '',
      '# trailing thought',
      '',
    ].join('\n');
    const formatted = formatYaml(source);
    expect(formatted).toContain('# the whole file');
    expect(formatted).toContain('# why this port');
    expect(formatted).toContain('# inline');
    expect(formatted).toContain('# trailing thought');
  });

  it('re-indents to the chosen unit without changing a value', () => {
    const formatted = formatYaml('a:\n      b: 1\n      c: hello\n');
    expect(formatted).toBe('a:\n  b: 1\n  c: hello\n');
  });

  it('is idempotent — formatting an already-formatted document is a no-op', () => {
    const once = formatYaml('a:\n      b: 1\n# note\nc: [1, 2]\n');
    expect(formatYaml(once)).toBe(once);
  });

  it('leaves a broken document untouched rather than deleting what it could not parse', () => {
    const broken = 'a: [1, 2\n';
    expect(formatYaml(broken)).toBe(broken);
  });

  it('keeps every document of a multi-document stream', () => {
    const formatted = formatYaml('a: 1\n---\nb: 2\n');
    expect(formatted).toBe('a: 1\n---\nb: 2\n');
  });

  it('does not re-wrap a long value into a different string', () => {
    const long = `note: ${'x'.repeat(200)}\n`;
    expect(formatYaml(long)).toBe(long);
  });
});

describe('toFlow / toBlock', () => {
  it('compacts every collection, the outermost one included', () => {
    expect(toFlow('a:\n  - 1\n  - 2\n')).toBe('{ a: [ 1, 2 ] }\n');
  });

  it('keeps comments through a compact', () => {
    expect(toFlow('# head\na:\n  - 1\n')).toContain('# head');
  });

  it('expands flow collections back into block style', () => {
    expect(toBlock('a: [1, 2]\n')).toBe('a:\n  - 1\n  - 2\n');
  });

  it('round-trips values through both styles', () => {
    const source = 'server:\n  hosts:\n    - one\n    - two\n  port: 4646\n';
    const back = toBlock(toFlow(source));
    expect(analyzeYaml(back).documents[0]!.value).toEqual(
      analyzeYaml(source).documents[0]!.value,
    );
  });

  it('leaves a broken document untouched', () => {
    expect(toFlow('a: [1, 2\n')).toBe('a: [1, 2\n');
  });
});

describe('yamlToJson / jsonToYaml', () => {
  it('round-trips values unchanged', () => {
    const source = 'name: bifrost\nport: 4646\nhosts:\n  - a\n  - b\nnested:\n  on: true\n';
    const json = yamlToJson(source);
    const back = jsonToYaml(json);
    expect(analyzeYaml(back).documents[0]!.value).toEqual(
      analyzeYaml(source).documents[0]!.value,
    );
  });

  it('turns a multi-document stream into a JSON array rather than dropping documents', () => {
    expect(JSON.parse(yamlToJson('a: 1\n---\nb: 2\n'))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('emits a bare value for a single document', () => {
    expect(JSON.parse(yamlToJson('a: 1\n'))).toEqual({ a: 1 });
  });

  it('expands anchors, because JSON has none', () => {
    expect(JSON.parse(yamlToJson('base: &b {x: 1}\nuse: *b\n'))).toEqual({
      base: { x: 1 },
      use: { x: 1 },
    });
  });

  it('throws on a document that does not parse', () => {
    expect(() => yamlToJson('a: [1, 2\n')).toThrow();
  });

  it('throws on invalid JSON', () => {
    expect(() => jsonToYaml('{oops')).toThrow();
  });
});

describe('parseDocuments', () => {
  it('splits a --- separated stream', () => {
    const docs = parseDocuments('a: 1\n---\nb: 2\n---\nc: 3\n');
    expect(docs.map((doc) => doc.value)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(docs.map((doc) => doc.index)).toEqual([0, 1, 2]);
  });

  it('resolves merge keys the way Docker Compose does', () => {
    const [doc] = parseDocuments('base: &b\n  a: 1\nchild:\n  <<: *b\n  b: 2\n');
    expect(doc!.value).toEqual({ base: { a: 1 }, child: { a: 1, b: 2 } });
  });

  it('records where an alias sits so the tree can badge it', () => {
    const [doc] = parseDocuments('base: &b\n  a: 1\nuse: *b\n');
    expect(doc!.aliasPaths.get('use')).toBe('b');
    expect(doc!.anchors).toEqual([expect.objectContaining({ name: 'b', uses: 1 })]);
  });

  it('records an alias inside a sequence by index', () => {
    const [doc] = parseDocuments('base: &b 1\nlist:\n  - *b\n  - 2\n');
    expect(doc!.aliasPaths.get('list[0]')).toBe('b');
  });
});

describe('yamlStats', () => {
  it('counts bytes, lines and documents', () => {
    const stats = yamlStats('a: 1\n---\nb: 2\n');
    expect(stats.documents).toBe(2);
    expect(stats.lines).toBe(4);
    expect(stats.bytes).toBe(14);
    expect(stats.valid).toBe(true);
  });

  it('counts multi-byte characters as bytes, not code points', () => {
    expect(yamlStats('a: héllo 🌉\n').bytes).toBe(new TextEncoder().encode('a: héllo 🌉\n').length);
  });

  it('is not valid while an error stands', () => {
    expect(yamlStats('a: [1, 2\n').valid).toBe(false);
  });
});
