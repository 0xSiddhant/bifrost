import { describe, expect, it } from 'vitest';
import { buildUrl, decodeHtml, encodeHtml, parseUrl, runUrl } from './url';

describe('runUrl percent-encoding', () => {
  it('shows the difference between component and full encoding', () => {
    const url = 'https://a.test/path?x=1&y=2';
    expect(runUrl(url, 'component', 'encode').value).toBe(
      'https%3A%2F%2Fa.test%2Fpath%3Fx%3D1%26y%3D2',
    );
    // encodeURI leaves the URL's own delimiters alone.
    expect(runUrl(url, 'full', 'encode').value).toBe(url);
  });

  it('encodes the characters that break a query value', () => {
    expect(runUrl('a&b=c d', 'component', 'encode').value).toBe('a%26b%3Dc%20d');
    expect(runUrl('héllo 🌉', 'component', 'encode').value).toBe('h%C3%A9llo%20%F0%9F%8C%89');
  });

  it('round-trips both modes', () => {
    for (const text of ['a&b=c d', 'héllo 🌉', 'plain', 'sla/shes?and=things#hash']) {
      expect(runUrl(runUrl(text, 'component', 'encode').value, 'component', 'decode').value).toBe(text);
    }
    const url = 'https://a.test/a%20b?x=1';
    expect(runUrl(runUrl(url, 'full', 'encode').value, 'full', 'decode').value).toBe(url);
  });

  it('reports a truncated escape instead of throwing URIError', () => {
    const result = runUrl('%E0%A4', 'component', 'decode');
    expect(result.value).toBe('');
    expect(result.error).toMatch(/percent-encoded/);
  });

  it('treats empty input as empty', () => {
    expect(runUrl('', 'component', 'encode')).toEqual({ value: '', error: null });
  });
});

describe('HTML entities', () => {
  it('escapes exactly the five characters that change meaning', () => {
    expect(encodeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
    );
  });

  it('round-trips through the tool', () => {
    const text = `<script>alert("hi" & 'bye')</script>`;
    expect(runUrl(runUrl(text, 'html', 'encode').value, 'html', 'decode').value).toBe(text);
  });

  it('decodes numeric and hex references too', () => {
    expect(decodeHtml('&#72;&#101;&#x6c;&#x6C;&#111;')).toBe('Hello');
    expect(decodeHtml('&amp;lt;')).toBe('&lt;');
  });

  it('leaves an unknown entity alone rather than eating it', () => {
    expect(decodeHtml('&notanentity;')).toBe('&notanentity;');
  });
});

describe('parseUrl', () => {
  it('splits a URL into its parts', () => {
    const parts = parseUrl('https://user:pw@bifrost.local:4646/go/router?a=1&b=two#frag');
    expect(parts).toEqual({
      scheme: 'https',
      username: 'user',
      password: 'pw',
      host: 'bifrost.local',
      port: '4646',
      path: '/go/router',
      params: [
        { key: 'a', value: '1' },
        { key: 'b', value: 'two' },
      ],
      hash: 'frag',
    });
  });

  it('decodes query values, which is the point of the table', () => {
    const parts = parseUrl('https://a.test/?q=h%C3%A9llo%20there&empty=');
    expect(parts?.params).toEqual([
      { key: 'q', value: 'héllo there' },
      { key: 'empty', value: '' },
    ]);
  });

  it('leaves a default port empty rather than inventing 443', () => {
    expect(parseUrl('https://a.test/x')?.port).toBe('');
  });

  it('handles non-http schemes, which are still URLs', () => {
    expect(parseUrl('mailto:someone@a.test')?.scheme).toBe('mailto');
  });

  it('returns null for something that is not a URL', () => {
    expect(parseUrl('not a url')).toBeNull();
    expect(parseUrl('')).toBeNull();
  });
});

describe('buildUrl', () => {
  it('rebuilds what parseUrl produced', () => {
    const original = 'https://bifrost.local:4646/go/router?a=1&b=two#frag';
    const parts = parseUrl(original);
    if (!parts) throw new Error('expected parts');
    expect(buildUrl(parts)).toBe(original);
  });

  it('re-encodes edited params', () => {
    const parts = parseUrl('https://a.test/');
    if (!parts) throw new Error('expected parts');
    parts.params.push({ key: 'q', value: 'héllo there' });
    expect(buildUrl(parts)).toBe('https://a.test/?q=h%C3%A9llo%20there');
  });

  it('drops a param whose key was cleared, and omits an empty query', () => {
    const parts = parseUrl('https://a.test/x?a=1');
    if (!parts) throw new Error('expected parts');
    parts.params = [{ key: '', value: 'orphan' }];
    expect(buildUrl(parts)).toBe('https://a.test/x');
  });

  it('repairs a path typed without its leading slash', () => {
    const parts = parseUrl('https://a.test/');
    if (!parts) throw new Error('expected parts');
    parts.path = 'go/router';
    expect(buildUrl(parts)).toBe('https://a.test/go/router');
  });
});
