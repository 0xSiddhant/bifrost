import { describe, expect, it } from 'vitest';
import { advisories } from './advisories';
import { jsonToYaml, yamlToJson } from './convert';
import { documentValues } from './documents';
import { formatYaml, toBlock, toFlow } from './format';
import { MAX_ALIAS_COUNT, parseYamlDocument, toValue } from './parse';
import { isValidYaml, validateYaml } from './validate';

const kinds = (text: string) => advisories(text).map((a) => a.kind);

describe('validateYaml', () => {
  it('accepts an empty document and ordinary YAML', () => {
    expect(validateYaml('')).toEqual([]);
    expect(validateYaml('   \n')).toEqual([]);
    expect(validateYaml('name: bifrost\nspec:\n  replicas: 3\n')).toEqual([]);
  });

  it('reports bad indentation with a line', () => {
    const issues = validateYaml('a:\n  - x\n b: 1\n');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.line).toBe(3);
    expect(issues[0]?.message).toMatch(/indent|column/i);
  });

  it('reports a tab used as indentation', () => {
    const issues = validateYaml('a:\n\tb: 1\n');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message).toMatch(/tab/i);
  });

  it('reports an unclosed flow collection', () => {
    expect(validateYaml('a: {b: 1\nc: 2\n').length).toBeGreaterThan(0);
  });

  // The one downgrade: legal YAML that every parser accepts, so it must not
  // block a save. It surfaces through advisories() instead.
  it('does NOT treat a duplicate key as an error', () => {
    expect(validateYaml('a: 1\na: 2\n')).toEqual([]);
    expect(isValidYaml('a: 1\na: 2\n')).toBe(true);
    expect(kinds('a: 1\na: 2\n')).toContain('duplicate-key');
  });

  it('finds an error in the third document of a stream, offset into the whole text', () => {
    const text = '---\na: 1\n---\nb: 2\n---\nc:\n  - x\n d: 1\n';
    const issues = validateYaml(text);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.offset).toBeGreaterThan(text.indexOf('c:'));
  });

  it('strips the caret diagram out of the message', () => {
    const [issue] = validateYaml('a:\n\tb: 1\n');
    expect(issue?.message).not.toContain('\n');
    expect(issue?.message).not.toMatch(/at line \d+, column \d+/);
  });
});

describe('formatYaml', () => {
  // Criterion 2 — the one that fails a naive parse + stringify.
  it('preserves head, key-level and trailing comments', () => {
    const source = `# head comment
name: bifrost # trailing
spec:
  # key-level
  replicas: 3
`;
    const formatted = formatYaml(source);
    expect(formatted).toContain('# head comment');
    expect(formatted).toContain('# trailing');
    expect(formatted).toContain('# key-level');
  });

  it('re-indents without changing a value', () => {
    const formatted = formatYaml('a:\n      b:   hello world\n      c: 3\n');
    expect(formatted).toBe('a:\n  b: hello world\n  c: 3\n');
  });

  it('is a no-op on an already-formatted document', () => {
    const tidy = formatYaml('a:\n  b: 1\n  c:\n    - 1\n    - 2\n');
    expect(formatYaml(tidy)).toBe(tidy);
  });

  // Formatting is not a repair tool: emitting a half-understood document over
  // the user's text is worse than doing nothing.
  it('returns an unparseable document unchanged', () => {
    const broken = 'a:\n\tb: 1\n';
    expect(formatYaml(broken)).toBe(broken);
  });

  it('keeps every document in a --- stream', () => {
    const formatted = formatYaml('---\na:   1\n---\nb:   2\n');
    expect(formatted).toBe('---\na: 1\n---\nb: 2\n');
  });
});

describe('toFlow / toBlock', () => {
  it('collapses block style to flow', () => {
    expect(toFlow('a:\n  b: 1\n  c:\n    - 1\n    - 2\n').trim()).toBe('{ a: { b: 1, c: [ 1, 2 ] } }');
  });

  it('expands flow style to block', () => {
    expect(toBlock('{a: {b: 1, c: [1, 2]}}')).toBe('a:\n  b: 1\n  c:\n    - 1\n    - 2\n');
  });

  it('round-trips block → flow → block', () => {
    const block = 'a:\n  b: 1\n  c:\n    - 1\n    - 2\n';
    expect(toBlock(toFlow(block))).toBe(block);
  });

  it('leaves an unparseable document alone', () => {
    expect(toFlow('a:\n\tb: 1\n')).toBe('a:\n\tb: 1\n');
    expect(toBlock('a:\n\tb: 1\n')).toBe('a:\n\tb: 1\n');
  });
});

describe('yamlToJson / jsonToYaml', () => {
  it('round-trips values unchanged', () => {
    const yaml = 'name: bifrost\ncount: 3\nflags:\n  - a\n  - b\nnested:\n  deep: true\n';
    const json = yamlToJson(yaml);
    expect(json.ok).toBe(true);
    if (!json.ok) return;
    const back = jsonToYaml(json.text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(yamlToJson(back.text)).toEqual(json);
  });

  it('renders a --- stream as an array rather than losing documents', () => {
    const json = yamlToJson('---\na: 1\n---\nb: 2\n');
    expect(json.ok && JSON.parse(json.text)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('keeps a single document as a bare value', () => {
    const json = yamlToJson('a: 1\n');
    expect(json.ok && JSON.parse(json.text)).toEqual({ a: 1 });
  });

  it('expands anchors into the JSON, since JSON has no aliases', () => {
    const json = yamlToJson('base: &b\n  a: 1\nuse: *b\n');
    expect(json.ok && JSON.parse(json.text)).toEqual({ base: { a: 1 }, use: { a: 1 } });
  });

  it('refuses to convert YAML that does not parse', () => {
    const json = yamlToJson('a:\n\tb: 1\n');
    expect(json.ok).toBe(false);
    expect(json.ok === false && json.reason).toMatch(/fix the yaml errors/i);
  });

  it('reports bad JSON rather than throwing', () => {
    const back = jsonToYaml('{not json');
    expect(back.ok).toBe(false);
    expect(back.ok === false && back.reason).toMatch(/not valid json/i);
  });

  it('passes an empty buffer straight through both ways', () => {
    expect(yamlToJson('')).toEqual({ ok: true, text: '' });
    expect(jsonToYaml('')).toEqual({ ok: true, text: '' });
  });
});

/**
 * Criterion 8's bomb guard. Seven nested nine-way anchors is the classic
 * billion-laughs shape: a few hundred bytes, astronomically many nodes.
 */
describe('alias bomb guard', () => {
  const bomb = `a: &a ["x","x","x","x","x","x","x","x","x"]
b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]
c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]
d: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]
e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]
f: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e]
g: [*f,*f,*f,*f,*f,*f,*f,*f,*f]
`;

  it('refuses to expand it, and reports why instead of throwing', () => {
    const result = toValue(parseYamlDocument(bomb));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(String(MAX_ALIAS_COUNT));
  });

  it('does not throw out of the JSON conversion either', () => {
    const json = yamlToJson(bomb);
    expect(json.ok).toBe(false);
  });

  // Formatting never expands an alias — it re-emits `*a` — so it must still work.
  it('still formats, because formatting never expands an alias', () => {
    expect(formatYaml(bomb)).toContain('*a');
  });

  it('allows an ordinary document with a few aliases', () => {
    const result = toValue(parseYamlDocument('base: &b { a: 1 }\none: *b\ntwo: *b\n'));
    expect(result.ok).toBe(true);
  });
});

describe('advisories', () => {
  it('says nothing about an empty or unremarkable document', () => {
    expect(advisories('')).toEqual([]);
    expect(kinds('name: bifrost\ncount: 3\nready: true\n')).toEqual([]);
  });

  describe('the Norway problem', () => {
    it.each(['no', 'yes', 'on', 'off', 'y', 'n', 'NO', 'Off'])('flags unquoted %s', (word) => {
      expect(kinds(`country: ${word}\n`)).toContain('norway');
    });

    it('says nothing about the same word quoted', () => {
      expect(kinds('country: "no"\n')).not.toContain('norway');
      expect(kinds("country: 'yes'\n")).not.toContain('norway');
    });

    it('says nothing about a real boolean', () => {
      expect(kinds('ready: true\nbroken: false\n')).not.toContain('norway');
    });

    it('names the value in the message', () => {
      const [advisory] = advisories('country: no\n');
      expect(advisory?.message).toContain('"no"');
      expect(advisory?.line).toBe(1);
    });
  });

  describe('version-like values', () => {
    it('flags a value that loses a digit', () => {
      expect(kinds('version: 1.10\n')).toContain('version-like');
      expect(kinds('version: 1.0\n')).toContain('version-like');
    });

    it('says nothing when the number survives verbatim', () => {
      expect(kinds('version: 1.1\n')).not.toContain('version-like');
      expect(kinds('ratio: 0.5\n')).not.toContain('version-like');
    });

    it('says nothing about a quoted version', () => {
      expect(kinds('version: "1.10"\n')).not.toContain('version-like');
    });
  });

  describe('unsafe integers', () => {
    it('flags one past the safe range', () => {
      expect(kinds('big: 9007199254740993\n')).toContain('unsafe-integer');
    });

    it('says nothing about ordinary or zero-padded integers', () => {
      expect(kinds('small: 42\npadded: 007\n')).not.toContain('unsafe-integer');
    });

    it('says nothing about a quoted one', () => {
      expect(kinds('big: "9007199254740993"\n')).not.toContain('unsafe-integer');
    });
  });

  describe('duplicate keys', () => {
    it('flags a repeated key', () => {
      expect(kinds('a: 1\nb: 2\na: 3\n')).toContain('duplicate-key');
    });

    it('says nothing when the same key appears in different mappings', () => {
      expect(kinds('one:\n  name: x\ntwo:\n  name: y\n')).not.toContain('duplicate-key');
    });
  });

  describe('tabs', () => {
    it('flags a tab in indentation', () => {
      expect(kinds('a:\n\tb: 1\n')).toContain('tab-indent');
    });

    it('says nothing about a tab inside a quoted value', () => {
      expect(kinds('a: "b\tc"\n')).not.toContain('tab-indent');
    });
  });

  describe('anchors', () => {
    it('names the anchors and marks each alias use', () => {
      const found = advisories('base: &base\n  a: 1\none: *base\ntwo: *base\n');
      const anchorAdvisories = found.filter((a) => a.kind === 'anchor');
      expect(anchorAdvisories.some((a) => a.message.includes('&base'))).toBe(true);
      expect(anchorAdvisories.filter((a) => a.message.includes('*base'))).toHaveLength(2);
    });

    it('says nothing about a document with no anchors', () => {
      expect(kinds('a: 1\n')).not.toContain('anchor');
    });
  });

  // Criterion 6: advisories never change a byte.
  it('changes no bytes — a flagged document formats to itself', () => {
    const source = 'country: no\nversion: 1.10\n';
    expect(advisories(source).length).toBeGreaterThan(0);
    expect(formatYaml(source)).toBe(source);
  });

  it('returns everything in document order', () => {
    const found = advisories('a: 1\na: 2\ncountry: no\nversion: 1.10\n');
    const offsets = found.map((a) => a.offset);
    expect([...offsets].sort((x, y) => x - y)).toEqual(offsets);
  });
});

describe('documentValues', () => {
  it('materialises every document in a stream', () => {
    expect(documentValues('---\na: 1\n---\nb: 2\n')).toEqual([
      { index: 1, value: { a: 1 }, error: null },
      { index: 2, value: { b: 2 }, error: null },
    ]);
  });

  it('keeps the good documents when one is broken', () => {
    const values = documentValues('---\na: 1\n---\nb:\n  - x\n c: 1\n---\nd: 2\n');
    expect(values).toHaveLength(3);
    expect(values[0]?.value).toEqual({ a: 1 });
    expect(values[1]?.error).toBeTruthy();
    expect(values[2]?.value).toEqual({ d: 2 });
  });

  it('is empty for an empty buffer', () => {
    expect(documentValues('  ')).toEqual([]);
  });
});
