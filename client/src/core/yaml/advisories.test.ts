import { describe, expect, it } from 'vitest';
import { advisories, formatYaml, validateYaml } from './index';
import type { YamlAdvisoryKind } from './advisories';

const kinds = (text: string): YamlAdvisoryKind[] => advisories(text).map((one) => one.kind);
const of = (text: string, kind: YamlAdvisoryKind) =>
  advisories(text).filter((one) => one.kind === kind);

describe('the Norway problem (boolish)', () => {
  it.each(['no', 'No', 'NO', 'yes', 'Yes', 'YES', 'on', 'On', 'off', 'OFF', 'y', 'n', 'N'])(
    'flags an unquoted %s',
    (value) => {
      expect(of(`country: ${value}\n`, 'boolish')).toHaveLength(1);
    },
  );

  it('says what the other reader will see', () => {
    expect(of('country: no\n', 'boolish')[0]!.message).toContain('false');
    expect(of('enabled: yes\n', 'boolish')[0]!.message).toContain('true');
  });

  it('does not flag a quoted one — quoting is the fix, so it must go quiet', () => {
    expect(kinds("country: 'no'\n")).not.toContain('boolish');
    expect(kinds('country: "no"\n')).not.toContain('boolish');
  });

  it('does not flag true/false, which are booleans under both versions', () => {
    expect(kinds('enabled: true\nother: false\n')).not.toContain('boolish');
  });

  it('does not flag a word that merely contains one', () => {
    expect(kinds('country: norway\nnote: nothing\n')).not.toContain('boolish');
  });

  it('flags a boolish key too — a key flips just as silently as a value', () => {
    expect(of('no: 1\n', 'boolish')).toHaveLength(1);
  });

  it('changes no bytes: the document still formats to itself', () => {
    const source = 'country: no\n';
    expect(formatYaml(source)).toBe(source);
    expect(validateYaml(source)).toEqual([]);
  });
});

describe('duplicate keys', () => {
  it('flags the second occurrence and points at the first', () => {
    const found = of('a: 1\nb: 2\na: 3\n', 'duplicate-key');
    expect(found).toHaveLength(1);
    expect(found[0]!.line).toBe(3);
    expect(found[0]!.message).toContain('line 1');
  });

  it('flags duplicates in a nested mapping', () => {
    expect(of('outer:\n  x: 1\n  x: 2\n', 'duplicate-key')).toHaveLength(1);
  });

  it('does not flag the same key in two different mappings', () => {
    expect(kinds('one:\n  x: 1\ntwo:\n  x: 2\n')).not.toContain('duplicate-key');
  });

  it('does not flag repeated <<, which YAML allows on purpose', () => {
    const text = 'a: &a {x: 1}\nb: &b {y: 2}\nc:\n  <<: *a\n  <<: *b\n';
    expect(kinds(text)).not.toContain('duplicate-key');
  });

  it('is non-blocking — the document still saves', () => {
    expect(validateYaml('a: 1\na: 2\n')).toEqual([]);
  });
});

describe('tabs in indentation', () => {
  it('flags the line and the character', () => {
    const found = of('root:\n\tchild: 1\n', 'tab-indent');
    expect(found).toHaveLength(1);
    expect(found[0]!.line).toBe(2);
    expect(found[0]!.offset).toBe('root:\n'.length);
  });

  it('is found even though the document does not parse at all', () => {
    // The parser gives up here; the scan does not, which is the whole reason
    // this advisory is a text scan rather than a tree walk.
    expect(validateYaml('root:\n\tchild: 1\n').length).toBeGreaterThan(0);
    expect(of('root:\n\tchild: 1\n', 'tab-indent')).toHaveLength(1);
  });

  it('does not flag a tab inside a value, which is legal', () => {
    expect(kinds('note: "a\tb"\n')).not.toContain('tab-indent');
  });

  it('does not flag ordinary space indentation', () => {
    expect(kinds('root:\n  child: 1\n')).not.toContain('tab-indent');
  });
});

describe('version-like and lossy numbers', () => {
  it('flags 1.10, which is the number 1.1', () => {
    const found = of('version: 1.10\n', 'lossy-number');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('1.1');
  });

  it('flags a leading-zero number', () => {
    expect(of('build: 007\n', 'lossy-number')).toHaveLength(1);
  });

  it('does not flag a quoted version', () => {
    expect(kinds("version: '1.10'\n")).not.toContain('lossy-number');
  });

  it('does not flag a number whose text survives the round trip', () => {
    expect(kinds('port: 4646\nratio: 1.5\n')).not.toContain('lossy-number');
  });

  it('does not flag a hex literal, which is written that way deliberately', () => {
    expect(kinds('mask: 0xFF\n')).not.toContain('lossy-number');
  });
});

describe('unsafe integers', () => {
  it('flags an id past 2^53', () => {
    const found = of('id: 9007199254740993\n', 'unsafe-integer');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('9007199254740992');
  });

  it('does not double-report it as a lossy number', () => {
    expect(kinds('id: 9007199254740993\n')).not.toContain('lossy-number');
  });

  it('does not flag an integer inside the safe range', () => {
    expect(kinds('id: 9007199254740991\n')).not.toContain('unsafe-integer');
  });

  it('does not flag a quoted one — quoting keeps every digit', () => {
    expect(kinds("id: '9007199254740993'\n")).not.toContain('unsafe-integer');
  });
});

describe('anchors and aliases', () => {
  it('names an anchor and counts its uses', () => {
    const found = of('base: &b {x: 1}\nuse: *b\nagain: *b\n', 'anchor');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('&b');
    expect(found[0]!.message).toContain('2 aliases');
  });

  it('says when an anchor is never referenced', () => {
    expect(of('base: &b {x: 1}\n', 'anchor')[0]!.message).toContain('never referenced');
  });

  it('says nothing about a document with no anchors', () => {
    expect(kinds('a: 1\n')).not.toContain('anchor');
  });
});

describe('merge keys', () => {
  it('explains that << was merged', () => {
    const found = of('base: &b {x: 1}\nchild:\n  <<: *b\n', 'merge-key');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('1.2');
  });

  it('says nothing about a document without one', () => {
    expect(kinds('a: 1\n')).not.toContain('merge-key');
  });
});

describe('parser warnings', () => {
  it('surfaces a tag it could not resolve, which silently became a string', () => {
    expect(of('a: !!weird 1\n', 'parser-warning')).toHaveLength(1);
  });

  it('says nothing about an ordinary document', () => {
    expect(kinds('a: 1\n')).not.toContain('parser-warning');
  });
});

describe('the rail as a whole', () => {
  it('stays quiet on a clean document', () => {
    expect(advisories('name: bifrost\nport: 4646\nhosts:\n  - a\n  - b\n')).toEqual([]);
  });

  it('is sorted by position, so the rail reads top to bottom', () => {
    const found = advisories('a: no\nb: 1.10\nc: &x 1\nd: *x\ne: no\n');
    const offsets = found.map((one) => one.offset);
    expect([...offsets].sort((x, y) => x - y)).toEqual(offsets);
  });

  it('says nothing about a document that does not parse — no confident nonsense', () => {
    expect(kinds('a: [1, 2\n')).toEqual([]);
  });
});
