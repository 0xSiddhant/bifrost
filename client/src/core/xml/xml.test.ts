// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  analyzeXml,
  detectIndentUnit,
  formatXml,
  minifyXml,
  parseXml,
  scanElementSpans,
  validateXml,
} from './index';

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleName</key>
\t<string>Bifrost</string>
\t<key>CFBundleVersion</key>
\t<integer>3</integer>
\t<key>LSMinimumSystemVersion</key>
\t<real>13.5</real>
\t<key>LSUIElement</key>
\t<true/>
\t<key>NSAppTransportSecurity</key>
\t<dict>
\t\t<key>NSAllowsLocalNetworking</key>
\t\t<false/>
\t</dict>
\t<key>Seeds</key>
\t<array>
\t\t<string>alpha</string>
\t\t<string>beta</string>
\t</array>
\t<key>Stamp</key>
\t<date>2026-08-29T09:00:00Z</date>
\t<key>Blob</key>
\t<data>Qmlmcm9zdA==</data>
</dict>
</plist>
`;

describe('scanElementSpans', () => {
  it('spans every element and skips the prologue, comments and CDATA', () => {
    const text = `<?xml version="1.0"?>\n<!-- a note -->\n<r a="1&gt;2"><b/><c><![CDATA[<not an element/>]]></c></r>`;
    const spans = scanElementSpans(text);
    expect(spans.map((span) => span.name)).toEqual(['r', 'b', 'c']);
    const root = spans[0];
    expect(text.slice(root!.start, root!.end)).toBe(
      '<r a="1&gt;2"><b/><c><![CDATA[<not an element/>]]></c></r>',
    );
    // A `>` inside a quoted attribute must not end the start tag early.
    expect(text.slice(root!.start, root!.innerStart)).toBe('<r a="1&gt;2">');
    expect(spans[1]?.empty).toBe(true);
  });

  it('does not mistake an internal DTD subset for markup', () => {
    const text = `<!DOCTYPE r [<!ENTITY x "a > b"> <!ELEMENT r (#PCDATA)>]>\n<r>hi</r>`;
    expect(scanElementSpans(text).map((span) => span.name)).toEqual(['r']);
  });

  it('gives an unclosed element a bounded span rather than -1', () => {
    const spans = scanElementSpans('<a><b>');
    expect(spans.every((span) => span.end > 0 && span.innerEnd > 0)).toBe(true);
  });
});

describe('parseXml / validateXml', () => {
  it('accepts a well-formed document', () => {
    const { doc, issue } = parseXml('<a><b>1</b></a>');
    expect(issue).toBeNull();
    expect(doc?.documentElement.nodeName).toBe('a');
    expect(validateXml('<a><b>1</b></a>')).toEqual([]);
  });

  it('reports a malformed document with a position inside the text', () => {
    const issues = validateXml('<r><a></r>');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBeTruthy();
    expect(issues[0]?.offset).toBeGreaterThanOrEqual(0);
    expect(issues[0]?.offset).toBeLessThanOrEqual('<r><a></r>'.length);
  });

  it('does not mistake an author’s own <parsererror> element for a failure', () => {
    // The namespace check is what makes this pass: this element is in no
    // namespace, a browser-synthesised one always carries a known one.
    expect(validateXml('<r><parsererror>not an error</parsererror></r>')).toEqual([]);
  });

  it('treats an empty document as neither valid nor an error', () => {
    expect(validateXml('   ')).toEqual([]);
    expect(analyzeXml('   ').stats.valid).toBe(false);
  });
});

/**
 * The corpus from PLAN-23's first task. The spike ran these through a real
 * Chromium on 2026-08-29 and recorded what it does: internal entities expand,
 * but a bomb is refused by libxml2's own amplification guard in ~10ms, and an
 * external entity is never resolved. **jsdom is not Chromium** — it expands one
 * level and stops — so what is asserted here is the property that holds in both
 * and is the one the acceptance criterion asks for: parsing terminates
 * promptly and never yields an exponentially expanded document.
 */
describe('entity expansion', () => {
  const bomb = (() => {
    let src = '<?xml version="1.0"?>\n<!DOCTYPE lolz [\n <!ENTITY lol "lol">\n';
    for (let i = 1; i <= 9; i += 1) {
      const prev = i === 1 ? 'lol' : `lol${i - 1}`;
      src += ` <!ENTITY lol${i} "${`&${prev};`.repeat(10)}">\n`;
    }
    return `${src}]>\n<lolz>&lol9;</lolz>`;
  })();

  it('never expands a billion-laughs document, and returns quickly', () => {
    const started = Date.now();
    const analysis = analyzeXml(bomb);
    expect(Date.now() - started).toBeLessThan(2000);
    const expanded = analysis.doc?.documentElement.textContent ?? '';
    // 10^9 characters if it had expanded; a few hundred either way if not.
    expect(expanded.length).toBeLessThan(100_000);
  });

  it('does not hang on a quadratic blowup', () => {
    // Scaled down from the spike's 50,000 x 2,000 (100 MB expanded): the point
    // is termination, and allocating 100 MB on every test run is a cost with no
    // extra signal. Chromium refuses this shape outright; **jsdom expands it**,
    // which is exactly why the assertion here is termination and not size — the
    // browser's refusal is recorded by the spike, not by a jsdom test claiming
    // to speak for it.
    const big = 'A'.repeat(5_000);
    const quad = `<?xml version="1.0"?><!DOCTYPE q [<!ENTITY a "${big}">]><q>${'&a;'.repeat(200)}</q>`;
    const started = Date.now();
    const analysis = analyzeXml(quad);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(analysis.stats.bytes).toBeGreaterThan(0);
  });

  it('never resolves an external entity', () => {
    const analysis = analyzeXml(
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/hostname">]><r>[&x;]</r>',
    );
    const body = analysis.doc?.documentElement.textContent ?? '';
    expect(body).not.toMatch(/[a-z]/);
  });
});

describe('formatXml', () => {
  it('keeps the prologue, the DOCTYPE and one-line leaf elements', () => {
    const formatted = formatXml(INFO_PLIST);
    expect(formatted).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(formatted).toContain('-//Apple//DTD PLIST 1.0//EN');
    expect(formatted).toContain('\t<key>CFBundleName</key>\n\t<string>Bifrost</string>');
    expect(formatted).toContain('\t\t<key>NSAllowsLocalNetworking</key>');
  });

  it('is idempotent', () => {
    const once = formatXml(INFO_PLIST);
    expect(formatXml(once)).toBe(once);
  });

  it('re-indents a collapsed document without changing what it says', () => {
    const collapsed = '<plist version="1.0"><dict><key>a</key><string>b</string></dict></plist>';
    const formatted = formatXml(collapsed);
    expect(formatted.split('\n').length).toBeGreaterThan(3);
    expect(analyzeXml(formatted).plist?.children[0]?.value).toBe('b');
  });

  it('leaves mixed content alone', () => {
    const mixed = '<p>Hello <b>world</b> again</p>';
    expect(formatXml(mixed).trim()).toBe(mixed);
  });

  it('returns a document that does not parse untouched', () => {
    expect(formatXml('<a><b></a>')).toBe('<a><b></a>');
  });

  it('preserves comments', () => {
    const withComment = '<r>\n  <!-- keep me -->\n  <a>1</a>\n</r>';
    expect(formatXml(withComment)).toContain('<!-- keep me -->');
  });
});

describe('minifyXml', () => {
  it('drops inter-tag whitespace and keeps the document equivalent', () => {
    const minified = minifyXml(INFO_PLIST);
    expect(minified).not.toContain('\n\t');
    expect(minified).toContain('<key>CFBundleName</key><string>Bifrost</string>');
    const analysis = analyzeXml(minified);
    expect(analysis.stats.valid).toBe(true);
    expect(analysis.plist?.children).toHaveLength(8);
  });

  it('round-trips back through format', () => {
    expect(analyzeXml(formatXml(minifyXml(INFO_PLIST))).plist?.children[1]?.value).toBe('3');
  });

  it('returns a document that does not parse untouched', () => {
    expect(minifyXml('<a>')).toBe('<a>');
  });
});

describe('detectIndentUnit', () => {
  it('follows the document rather than imposing a house style', () => {
    expect(detectIndentUnit(INFO_PLIST)).toBe('\t');
    expect(detectIndentUnit('<a>\n  <b/>\n</a>')).toBe('  ');
    expect(detectIndentUnit('<a><b/></a>')).toBe('  ');
  });
});

describe('analyzeXml', () => {
  it('reports stats and no plist tree for ordinary XML', () => {
    const analysis = analyzeXml('<config>\n  <name>bifrost</name>\n</config>\n');
    expect(analysis.isPlist).toBe(false);
    expect(analysis.plist).toBeNull();
    expect(analysis.stats).toMatchObject({ elements: 2, valid: true, lines: 4 });
  });

  it('maps every element to a span whose slice is that element', () => {
    const analysis = analyzeXml(INFO_PLIST);
    for (const [element, span] of analysis.spans) {
      expect(INFO_PLIST.slice(span.start, span.end)).toContain(element.nodeName);
      expect(INFO_PLIST.slice(span.start).startsWith(`<${element.nodeName}`)).toBe(true);
    }
  });
});
