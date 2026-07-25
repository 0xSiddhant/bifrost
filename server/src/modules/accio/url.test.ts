import { describe, expect, it } from 'vitest';
import { hostnameOf, isWebUrl, normalizeUrl, URL_MAX_LENGTH } from './url.js';

describe('normalizeUrl', () => {
  it('keeps a well-formed https URL intact', () => {
    expect(normalizeUrl('https://example.com/a/b?q=1#frag')).toBe('https://example.com/a/b?q=1#frag');
  });

  it('adds https:// to a scheme-less address', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUrl('example.com/path')).toBe('https://example.com/path');
  });

  it('treats host:port as a host with a port, not a scheme', () => {
    // The LAN case: pasting `localhost:3000/admin` must not parse "localhost"
    // as a URL scheme and fall over.
    expect(normalizeUrl('localhost:3000/admin')).toBe('https://localhost:3000/admin');
    expect(normalizeUrl('192.168.1.4:8080')).toBe('https://192.168.1.4:8080/');
  });

  it('preserves an explicit http scheme', () => {
    expect(normalizeUrl('http://bifrost.local:4646/')).toBe('http://bifrost.local:4646/');
  });

  it('lowercases the host but never the path', () => {
    expect(normalizeUrl('https://EXAMPLE.com/CaseSensitive')).toBe(
      'https://example.com/CaseSensitive',
    );
  });

  it('punycodes unicode hosts', () => {
    expect(normalizeUrl('https://пример.рф/страница')).toMatch(/^https:\/\/xn--/);
    expect(normalizeUrl('münchen.de')).toBe('https://xn--mnchen-3ya.de/');
  });

  it('drops default ports', () => {
    expect(normalizeUrl('https://example.com:443/x')).toBe('https://example.com/x');
    expect(normalizeUrl('http://example.com:80/x')).toBe('http://example.com/x');
  });

  it('trims trailing sentence punctuation and unbalanced closers', () => {
    expect(normalizeUrl('https://example.com/page.')).toBe('https://example.com/page');
    expect(normalizeUrl('https://example.com/page),')).toBe('https://example.com/page');
    // A balanced pair belongs to the URL (wikipedia-style paths).
    expect(normalizeUrl('https://en.wikipedia.org/wiki/Bridge_(structure)')).toBe(
      'https://en.wikipedia.org/wiki/Bridge_(structure)',
    );
  });

  it('strips wrapping brackets and quotes from a pasted address', () => {
    expect(normalizeUrl('<https://example.com/a>')).toBe('https://example.com/a');
    expect(normalizeUrl('"https://example.com/a"')).toBe('https://example.com/a');
  });

  it('normalizes an empty fragment or query away', () => {
    expect(normalizeUrl('https://example.com/a#')).toBe('https://example.com/a');
    expect(normalizeUrl('https://example.com/a?')).toBe('https://example.com/a');
  });

  it('rejects only the schemes that execute inside the page', () => {
    for (const raw of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'blob:https://example.com/uuid',
      'filesystem:https://example.com/temporary/x',
    ]) {
      expect(normalizeUrl(raw), raw).toBeNull();
    }
  });

  it('keeps every other scheme as an ordinary link', () => {
    // No special handling: the shelf stores them and the browser or the OS
    // decides what a click means.
    expect(normalizeUrl('chrome://chrome-urls/')).toBe('chrome://chrome-urls/');
    // chrome://net-internals is useless without its fragment — never strip it.
    expect(normalizeUrl('chrome://net-internals/#dns')).toBe('chrome://net-internals/#dns');
    expect(normalizeUrl('about:config')).toBe('about:config');
    expect(normalizeUrl('edge://settings/privacy')).toBe('edge://settings/privacy');
    expect(normalizeUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    expect(normalizeUrl('spotify://track/123')).toBe('spotify://track/123');
    expect(normalizeUrl('ftp://example.com/file')).toBe('ftp://example.com/file');
  });

  it('lowercases an opaque host so one page is one row', () => {
    // Non-special schemes keep an opaque host verbatim unless we normalize it.
    expect(normalizeUrl('chrome://Chrome-URLs/')).toBe('chrome://chrome-urls/');
  });

  it('rejects a scheme that names nothing', () => {
    expect(normalizeUrl('chrome://')).toBeNull();
    expect(normalizeUrl('about://')).toBeNull();
  });

  it('a bare "about:" is a word with a stray colon, not a scheme', () => {
    // The trailing-punctuation trim eats the colon first, leaving a bare host —
    // the same thing typing "about" alone would give. Single-label hosts stay
    // legal on purpose (`bifrost.local`, `http://wiki/`, `localhost:3000`).
    expect(normalizeUrl('about:')).toBe('https://about/');
  });
});

describe('isWebUrl', () => {
  it('marks the rows that have a page to fetch a title from', () => {
    expect(isWebUrl('https://example.com/a')).toBe(true);
    expect(isWebUrl('http://example.com/a')).toBe(true);
    expect(isWebUrl('chrome://flags/')).toBe(false);
    expect(isWebUrl('mailto:a@b.com')).toBe(false);
    expect(isWebUrl('nonsense')).toBe(false);
  });

  it('rejects empty, whitespace-bearing, and hostless input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('two words')).toBeNull();
    expect(normalizeUrl('https://')).toBeNull();
    expect(normalizeUrl('...')).toBeNull();
  });

  it('rejects addresses over the length cap', () => {
    expect(normalizeUrl(`https://example.com/${'a'.repeat(URL_MAX_LENGTH)}`)).toBeNull();
  });

  it('never throws on hostile input', () => {
    for (const raw of ['http://[', '%%%', 'https://ex ample.com', '://', 'h'.repeat(500)]) {
      expect(() => normalizeUrl(raw)).not.toThrow();
    }
  });
});

describe('hostnameOf', () => {
  it('returns the host without www or port', () => {
    expect(hostnameOf('https://www.example.com:8443/a')).toBe('example.com');
    expect(hostnameOf('https://docs.example.co.uk/a')).toBe('docs.example.co.uk');
  });

  it('returns an empty string for an unparseable URL', () => {
    expect(hostnameOf('not a url')).toBe('');
  });
});
