// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { analyzeXml } from './index';
import type { XmlAdvisoryKind } from './advisories';

function kinds(text: string): XmlAdvisoryKind[] {
  return analyzeXml(text).advisories.map((advisory) => advisory.kind);
}

function wrap(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
}

describe('duplicate <key>', () => {
  it('flags the repeat, not the first use, and says who wins', () => {
    const text = wrap(
      '\t<key>Name</key>\n\t<string>a</string>\n\t<key>Name</key>\n\t<string>b</string>',
    );
    const advisories = analyzeXml(text).advisories;
    expect(advisories).toHaveLength(1);
    expect(advisories[0]?.kind).toBe('duplicate-key');
    expect(advisories[0]?.message).toContain('keep the last one');
    // Points at the second key, which is the one a person needs to look at.
    expect(advisories[0]?.line).toBe(6);
    expect(text.slice(advisories[0]!.offset)).toMatch(/^<key>Name<\/key>\n\t<string>b/);
  });

  it('never blocks: the document is still valid and still saveable', () => {
    const analysis = analyzeXml(
      wrap('\t<key>a</key>\n\t<string>1</string>\n\t<key>a</key>\n\t<string>2</string>'),
    );
    expect(analysis.stats.valid).toBe(true);
    expect(analysis.issues).toEqual([]);
    expect(analysis.plist?.children).toHaveLength(2);
  });

  it('scopes duplicates to one dictionary — a repeat in a nested dict is fine', () => {
    expect(
      kinds(
        wrap(
          '\t<key>Name</key>\n\t<string>a</string>\n\t<key>Inner</key>\n\t<dict>\n\t\t<key>Name</key>\n\t\t<string>b</string>\n\t</dict>',
        ),
      ),
    ).toEqual([]);
  });
});

describe('malformed <date>', () => {
  it('accepts Apple’s shape and flags everything else', () => {
    expect(kinds(wrap('\t<key>d</key>\n\t<date>2026-08-29T09:00:00Z</date>'))).toEqual([]);
    expect(kinds(wrap('\t<key>d</key>\n\t<date>29 August 2026</date>'))).toEqual([
      'malformed-date',
    ]);
    expect(kinds(wrap('\t<key>d</key>\n\t<date>2026-08-29T09:00:00+01:00</date>'))).toEqual([
      'malformed-date',
    ]);
  });

  it('names an empty date as empty rather than quoting nothing', () => {
    const advisories = analyzeXml(wrap('\t<key>d</key>\n\t<date></date>')).advisories;
    expect(advisories[0]?.message).toContain('Empty date');
  });
});

describe('invalid base64 <data>', () => {
  it('accepts wrapped base64 and flags what will not decode', () => {
    expect(kinds(wrap('\t<key>b</key>\n\t<data>Qmlmcm9zdA==</data>'))).toEqual([]);
    expect(kinds(wrap('\t<key>b</key>\n\t<data>\n\t\tQmlm\n\t\tcm9zdA==\n\t</data>'))).toEqual([]);
    expect(kinds(wrap('\t<key>b</key>\n\t<data>not base64!</data>'))).toEqual(['invalid-base64']);
  });
});

describe('the rail as a whole', () => {
  it('is empty for a clean plist', () => {
    expect(kinds(wrap('\t<key>Name</key>\n\t<string>Bifrost</string>'))).toEqual([]);
  });

  it('says nothing at all about non-plist XML', () => {
    // The three advisories are plist semantics; `<date>` in someone's own
    // schema means whatever they decided it means.
    expect(kinds('<log><date>whenever</date><data>not base64!</data></log>')).toEqual([]);
  });

  it('reports every advisory in source order', () => {
    const text = wrap(
      '\t<key>a</key>\n\t<data>nope!</data>\n\t<key>a</key>\n\t<date>whenever</date>',
    );
    const advisories = analyzeXml(text).advisories;
    expect(advisories.map((advisory) => advisory.kind)).toEqual([
      'invalid-base64',
      'duplicate-key',
      'malformed-date',
    ]);
    const offsets = advisories.map((advisory) => advisory.offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });
});
