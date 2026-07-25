import { describe, expect, it } from 'vitest';
import { decodeEntities, extractTitle, TITLE_MAX_LENGTH } from './title.js';

describe('extractTitle', () => {
  it('reads a plain title', () => {
    expect(extractTitle('<html><head><title>Hello World</title></head><body>x</body></html>')).toBe(
      'Hello World',
    );
  });

  it('is case- and attribute-insensitive', () => {
    expect(extractTitle('<HEAD><TITLE data-x="1">Shout</TITLE></HEAD>')).toBe('Shout');
  });

  it('decodes entities', () => {
    expect(extractTitle('<head><title>Tips &amp; Tricks &mdash; Caf&#233;</title></head>')).toBe(
      'Tips & Tricks — Café',
    );
    expect(extractTitle('<head><title>&#x1F600; hi</title></head>')).toBe('😀 hi');
  });

  it('collapses whitespace and newlines', () => {
    expect(extractTitle('<head><title>\n  Spread\n   out  \n</title></head>')).toBe('Spread out');
  });

  it('prefers the head title over an inline svg title in the body', () => {
    const html =
      '<head><title>Real Page</title></head><body><svg><title>Icon label</title></svg></body>';
    expect(extractTitle(html)).toBe('Real Page');
  });

  it('falls back to the first title when there is no head', () => {
    expect(extractTitle('<title>Bare</title><p>x</p>')).toBe('Bare');
  });

  it('returns null when there is no title, or it is empty', () => {
    expect(extractTitle('<html><body>No title here</body></html>')).toBeNull();
    expect(extractTitle('<head><title>   </title></head>')).toBeNull();
    expect(extractTitle('')).toBeNull();
  });

  it('survives a truncated download (the capped-read case)', () => {
    // The fetcher stops reading mid-page; a dangling open tag must not throw.
    expect(extractTitle('<html><head><title>Cut off here')).toBeNull();
    expect(extractTitle('<html><head><title>Made it</title><meta charset="utf')).toBe('Made it');
  });

  it('truncates an overlong title with an ellipsis', () => {
    const title = extractTitle(`<head><title>${'a'.repeat(500)}</title></head>`);
    expect(title).toHaveLength(TITLE_MAX_LENGTH);
    expect(title?.endsWith('…')).toBe(true);
  });
});

describe('decodeEntities', () => {
  it('leaves unknown and out-of-range entities literal', () => {
    expect(decodeEntities('&notarealentity; &#x110000; &#0;')).toBe(
      '&notarealentity; &#x110000; &#0;',
    );
  });

  it('leaves lone surrogates literal rather than throwing', () => {
    expect(() => decodeEntities('&#xD800;')).not.toThrow();
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
  });
});
