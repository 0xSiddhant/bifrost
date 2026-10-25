import { describe, expect, it } from 'vitest';
import type { AccioLink } from '../../core/accio';
import {
  compareLinks,
  displayTitle,
  hostnameOf,
  linkMatches,
  parseTagInput,
  tileLetter,
  tileTone,
  unionTags,
  type ShelfFilter,
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

describe('linkMatches (the live-row predicate)', () => {
  const rows = [
    link({
      id: '1',
      url: 'https://cooking.example/pasta',
      title: 'Perfect Pasta',
      tags: ['recipes'],
    }),
    link({ id: '2', url: 'https://cooking.example/bread', title: 'Sourdough', tags: ['recipes'] }),
    link({ id: '3', url: 'https://work.example/pasta-report', title: 'Q3 Report', tags: ['work'] }),
  ];
  const ids = (filter: ShelfFilter) =>
    rows.filter((row) => linkMatches(row, filter)).map((r) => r.id);

  it('matches title and url, case-insensitively', () => {
    expect(ids({ q: 'PASTA', tag: null })).toEqual(['1', '3']);
    expect(ids({ q: 'work.example', tag: null })).toEqual(['3']);
  });

  it('composes search with the tag filter', () => {
    expect(ids({ q: 'pasta', tag: 'recipes' })).toEqual(['1']);
    expect(ids({ q: 'pasta', tag: 'work' })).toEqual(['3']);
    expect(ids({ q: 'sourdough', tag: 'work' })).toEqual([]);
  });

  it('an empty filter keeps everything', () => {
    expect(ids({ q: '   ', tag: null })).toHaveLength(3);
  });

  it('never matches an untitled row on a null title', () => {
    expect(linkMatches(link({ id: '9', url: 'https://x.dev/a' }), { q: 'null', tag: null })).toBe(
      false,
    );
  });
});

describe('compareLinks (the server order, for placing a live row)', () => {
  const rows = [
    link({ id: 'b', url: 'https://b.dev', title: 'Beta', createdAt: 2000 }),
    link({ id: 'a', url: 'https://a.dev', title: 'alpha', createdAt: 3000 }),
    link({ id: 'c', url: 'https://c.dev', title: 'Gamma', createdAt: 1000 }),
    link({ id: 'd', url: 'https://d.dev', title: null, createdAt: 3000 }),
  ];
  const order = (sort: 'newest' | 'oldest' | 'title') =>
    [...rows].sort((x, y) => compareLinks(x, y, sort)).map((r) => r.id);

  it('orders newest first, ties by id in the same direction', () => {
    expect(order('newest')).toEqual(['d', 'a', 'b', 'c']);
    expect(order('oldest')).toEqual(['c', 'b', 'a', 'd']);
  });

  it('orders titles by ASCII-lowered title, falling back to the url', () => {
    expect(order('title')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('unionTags', () => {
  it('unions the server facet with tags live rows introduced, alphabetically', () => {
    expect(
      unionTags(
        ['work'],
        [
          link({ id: '1', url: 'https://a.dev', tags: ['work', 'recipes'] }),
          link({ id: '3', url: 'https://c.dev' }),
        ],
      ),
    ).toEqual(['recipes', 'work']);
  });
});

describe('parseTagInput', () => {
  it('splits on commas and drops blanks', () => {
    expect(parseTagInput(' recipes , later ,, ')).toEqual(['recipes', 'later']);
    expect(parseTagInput('')).toEqual([]);
  });
});
