import { describe, expect, it } from 'vitest';
import type { AccioLink } from '../../core/accio';
import {
  allTags,
  displayTitle,
  filterLinks,
  hostnameOf,
  parseTagInput,
  sortLinks,
  tileLetter,
  tileTone,
} from './shelf';

function link(partial: Partial<AccioLink> & { id: string; url: string }): AccioLink {
  return {
    title: null,
    tags: [],
    authorDeviceId: null,
    createdAt: 1000,
    ...partial,
  };
}

describe('hostnameOf / tileLetter / tileTone', () => {
  it('strips www and the port', () => {
    expect(hostnameOf('https://www.example.com:8443/a')).toBe('example.com');
  });

  it('takes the first alphanumeric of the host as the tile glyph', () => {
    expect(tileLetter('https://www.github.com/x')).toBe('G');
    expect(tileLetter('https://192.168.1.4:8080')).toBe('1');
    // No host to read (unparseable, or a hostless scheme) → neutral glyph.
    expect(tileLetter('not a url')).toBe('·');
  });

  it('treats a non-http URL like any other — its host is just the host', () => {
    expect(hostnameOf('chrome://flags/#enable-foo')).toBe('flags');
    expect(tileLetter('chrome://flags/')).toBe('F');
    // Hostless URLs (about:config, mailto:) get the neutral glyph.
    expect(tileLetter('about:config')).toBe('·');
  });

  it('gives a host a stable tone in the 1..10 palette range', () => {
    const first = tileTone('https://example.com/a');
    expect(first).toBe(tileTone('https://example.com/completely/other/page'));
    expect(first).toBe(tileTone('https://www.example.com/a'));
    for (const url of ['https://a.dev', 'https://b.dev', 'https://c.dev', 'not a url']) {
      expect(tileTone(url)).toBeGreaterThanOrEqual(1);
      expect(tileTone(url)).toBeLessThanOrEqual(10);
    }
  });
});

describe('displayTitle', () => {
  it('prefers the title', () => {
    expect(displayTitle(link({ id: '1', url: 'https://x.dev/a', title: 'A Page' }))).toBe('A Page');
  });

  it('falls back to the address without scheme or trailing slash', () => {
    expect(displayTitle(link({ id: '1', url: 'https://example.com/' }))).toBe('example.com');
    expect(displayTitle(link({ id: '2', url: 'http://example.com/deep/path' }))).toBe(
      'example.com/deep/path',
    );
  });

  it('keeps a non-http scheme visible — only http(s) is noise worth hiding', () => {
    expect(displayTitle(link({ id: '3', url: 'chrome://chrome-urls/' }))).toBe(
      'chrome://chrome-urls',
    );
    expect(displayTitle(link({ id: '4', url: 'about:config' }))).toBe('about:config');
  });
});

describe('filterLinks', () => {
  const rows = [
    link({ id: '1', url: 'https://cooking.example/pasta', title: 'Perfect Pasta', tags: ['recipes'] }),
    link({ id: '2', url: 'https://cooking.example/bread', title: 'Sourdough', tags: ['recipes'] }),
    link({ id: '3', url: 'https://work.example/pasta-report', title: 'Q3 Report', tags: ['work'] }),
  ];

  it('matches title and url, case-insensitively', () => {
    expect(filterLinks(rows, { q: 'PASTA', tag: null }).map((r) => r.id)).toEqual(['1', '3']);
    expect(filterLinks(rows, { q: 'work.example', tag: null }).map((r) => r.id)).toEqual(['3']);
  });

  it('composes search with the tag filter', () => {
    expect(filterLinks(rows, { q: 'pasta', tag: 'recipes' }).map((r) => r.id)).toEqual(['1']);
    expect(filterLinks(rows, { q: 'pasta', tag: 'work' }).map((r) => r.id)).toEqual(['3']);
    expect(filterLinks(rows, { q: 'sourdough', tag: 'work' })).toEqual([]);
  });

  it('an empty filter keeps everything', () => {
    expect(filterLinks(rows, { q: '   ', tag: null })).toHaveLength(3);
  });

  it('never matches an untitled row on a null title', () => {
    const untitled = [link({ id: '9', url: 'https://x.dev/a' })];
    expect(filterLinks(untitled, { q: 'null', tag: null })).toEqual([]);
  });
});

describe('sortLinks', () => {
  const rows = [
    link({ id: 'b', url: 'https://b.dev', title: 'Beta', createdAt: 2000 }),
    link({ id: 'a', url: 'https://a.dev', title: 'alpha', createdAt: 3000 }),
    link({ id: 'c', url: 'https://c.dev', title: 'Gamma', createdAt: 1000 }),
  ];

  it('defaults to newest first', () => {
    expect(sortLinks(rows, 'newest').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortLinks(rows, 'oldest').map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by display title, case-insensitively', () => {
    expect(sortLinks(rows, 'title').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    const before = rows.map((r) => r.id);
    sortLinks(rows, 'title');
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('allTags', () => {
  it('is the deduped, alphabetical union', () => {
    expect(
      allTags([
        link({ id: '1', url: 'https://a.dev', tags: ['work', 'recipes'] }),
        link({ id: '2', url: 'https://b.dev', tags: ['recipes'] }),
        link({ id: '3', url: 'https://c.dev' }),
      ]),
    ).toEqual(['recipes', 'work']);
  });
});

describe('parseTagInput', () => {
  it('splits on commas and drops blanks', () => {
    expect(parseTagInput(' recipes , later ,, ')).toEqual(['recipes', 'later']);
    expect(parseTagInput('')).toEqual([]);
  });
});
