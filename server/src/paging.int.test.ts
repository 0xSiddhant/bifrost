import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { InjectOptions } from 'fastify';
import type { RunningApp } from './app.js';
import { createTestApp } from './testing/app.js';

/**
 * PLAN-31 — the opt-in paged form on the six list endpoints, proved over HTTP
 * against a real SQLite file: every row exactly once, exact mirrors across
 * ties, keyset pages that survive inserts and deletes between requests, and
 * the legacy bare-array form left exactly as it was.
 */
describe('list paging (PLAN-31)', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-paging-'));
    app = await createTestApp({
      STORAGE_ROOT: storageRoot,
      LIST_PAGE_SIZE: '3',
      LIST_PAGE_MAX: '5',
    });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const inject = (opts: InjectOptions) => app.fastify.inject(opts);
  const getJson = async (url: string) => {
    const response = await inject({ method: 'GET', url });
    expect(response.statusCode, url).toBe(200);
    return response.json();
  };

  interface DocRow {
    id: string;
  }

  describe.each(['runestone', 'edda', 'groot', 'atlas'])('%s documents', (kind) => {
    const ids: string[] = [];

    beforeAll(async () => {
      // Deliberate ties: three rows share a size, two share a name.
      const docs = [
        { name: 'Alpha', content: '{"a":1}' },
        { name: 'Beta', content: '{"a":1}' },
        { name: 'Beta', content: '{"a":1}' },
        { name: 'Gamma', content: '{"abc":12}' },
        { name: 'delta', content: '{"abcdef":123}' },
        { name: 'Epsilon', content: '[1]' },
        { name: 'zeta', content: '{"z":"zz"}' },
      ];
      for (const [index, doc] of docs.entries()) {
        const response = await inject({
          method: 'POST',
          url: `/api/${kind}`,
          headers: { 'x-bifrost-device': index % 2 === 0 ? 'device-even' : 'device-odd' },
          payload: doc,
        });
        expect(response.statusCode).toBe(201);
        ids.push(response.json().id);
      }
    });

    const walk = async (sort: string, order: string): Promise<string[]> => {
      const seen: string[] = [];
      for (let offset = 0; ; offset += 3) {
        const page = await getJson(
          `/api/${kind}?paged=true&sort=${sort}&order=${order}&offset=${offset}`,
        );
        expect(page.limit).toBe(3);
        expect(page.offset).toBe(offset);
        expect(page.total).toBe(7);
        seen.push(...page.items.map((row: DocRow) => row.id));
        if (page.items.length < 3) break;
      }
      return seen;
    };

    it.each(['name', 'size', 'created', 'modified'])(
      'offset pages cover every row once, and asc is the exact mirror of desc (sort=%s)',
      async (sort) => {
        const forward = await walk(sort, 'asc');
        const backward = await walk(sort, 'desc');
        expect([...forward].sort()).toEqual([...ids].sort());
        expect(new Set(forward).size).toBe(7);
        // Ties included: the tiebreak runs in the sort direction.
        expect(backward).toEqual([...forward].reverse());
      },
    );

    it('carries the unfiltered author facet and a filtered total', async () => {
      const byName = await getJson(`/api/${kind}?paged=true&q=beta`);
      expect(byName.total).toBe(2);
      const byAuthor = await getJson(`/api/${kind}?paged=true&author=device-odd`);
      expect(byAuthor.total).toBe(3);
      // Unfiltered: switching author must not first require clearing the filter.
      expect(byAuthor.authors).toEqual(['device-even', 'device-odd']);
    });

    it('clamps limit to LIST_PAGE_MAX and echoes it', async () => {
      const page = await getJson(`/api/${kind}?paged=true&limit=50`);
      expect(page.limit).toBe(5);
      expect(page.items).toHaveLength(5);
    });

    it('leaves the legacy array form as it was: bare array, asc(id) tiebreak', async () => {
      const rows: Array<{ id: string; sizeBytes: number }> = await getJson(
        `/api/${kind}?sort=size&order=desc`,
      );
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(7);
      // '{"a":1}' is 7 bytes, saved three times.
      const tied = rows.filter((row) => row.sizeBytes === 7);
      const tiedIds = tied.map((row) => row.id);
      expect(tiedIds).toEqual([...tiedIds].sort());
      expect(tiedIds).toHaveLength(3);
    });
  });

  describe('accio', () => {
    const urls: string[] = [];

    beforeAll(async () => {
      for (let i = 0; i < 12; i += 1) {
        const url = `https://site-${String(i).padStart(2, '0')}.example/`;
        const response = await inject({
          method: 'POST',
          url: '/api/accio',
          payload: {
            url,
            // Tied titles on purpose; untitled rows sort by their URL.
            title: i % 3 === 0 ? undefined : i % 2 === 0 ? 'Same Title' : 'same title',
            tags: i % 4 === 0 ? ['four', 'all'] : ['all'],
          },
        });
        expect(response.statusCode).toBe(201);
        urls.push(url);
      }
    });

    const walk = async (query: string, limit = 5): Promise<string[]> => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let step = 0; step < 50; step += 1) {
        const suffix: string = cursor ? `&cursor=${cursor}` : '';
        const page = await getJson(`/api/accio?paged=true&limit=${limit}&${query}${suffix}`);
        seen.push(...page.items.map((link: { url: string }) => link.url));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      return seen;
    };

    it.each([
      ['created', 'asc'],
      ['created', 'desc'],
      ['title', 'asc'],
      ['title', 'desc'],
      ['url', 'asc'],
      ['url', 'desc'],
    ])('keyset pages cover every row once (sort=%s order=%s)', async (sort, order) => {
      const walked = await walk(`sort=${sort}&order=${order}`);
      expect(new Set(walked).size).toBe(12);
      expect([...walked].sort()).toEqual([...urls].sort());
      // The walk agrees with one big page of the same order.
      const whole = await getJson(`/api/accio?paged=true&limit=5&sort=${sort}&order=${order}`);
      expect(walked.slice(0, 5)).toEqual(whole.items.map((link: { url: string }) => link.url));
    });

    it('an insert and a delete between two requests cause no duplicate and no skip', async () => {
      const first = await getJson('/api/accio?paged=true&limit=4');
      const shown: string[] = first.items.map((link: { url: string }) => link.url);

      const fresh = await inject({
        method: 'POST',
        url: '/api/accio',
        payload: { url: 'https://brand-new.example/' },
      });
      const all: Array<{ id: string; url: string }> = await getJson('/api/accio?limit=500');
      // Delete a row the scroll has not reached yet.
      const victim = all.find((link) => link.url === urls[2]);
      expect(victim).toBeDefined();
      await inject({ method: 'DELETE', url: `/api/accio/${victim?.id}` });

      let cursor: string | null = first.nextCursor;
      while (cursor) {
        const page = await getJson(`/api/accio?paged=true&limit=4&cursor=${cursor}`);
        shown.push(...page.items.map((link: { url: string }) => link.url));
        cursor = page.nextCursor;
      }
      expect(new Set(shown).size).toBe(shown.length);
      // Every original row except the deleted one; the new row sits above the
      // cursor (newest first), so this scroll never reaches it.
      expect([...shown].sort()).toEqual(urls.filter((url) => url !== urls[2]).sort());

      // Restore for later tests.
      await inject({ method: 'DELETE', url: `/api/accio/${fresh.json().id}` });
      const back = await inject({
        method: 'POST',
        url: '/api/accio',
        payload: { url: urls[2], tags: ['all'] },
      });
      expect(back.statusCode).toBe(201);
    });

    it('tag and q compose, with a filtered total and an unfiltered tag facet', async () => {
      const page = await getJson('/api/accio?paged=true&tag=four&q=site-0');
      // site-00, -04 and -08 carry "four"; q=site-0 matches 00–09.
      expect(page.total).toBe(3);
      expect(page.tags).toEqual(['all', 'four']);
    });

    it('400s a malformed cursor and one reused under another sort', async () => {
      const bad = await inject({ method: 'GET', url: '/api/accio?paged=true&cursor=nope' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error).toBe('BAD_CURSOR');

      const page = await getJson('/api/accio?paged=true&limit=2&sort=created&order=desc');
      const reused = await inject({
        method: 'GET',
        url: `/api/accio?paged=true&limit=2&sort=title&cursor=${page.nextCursor}`,
      });
      expect(reused.statusCode).toBe(400);
      expect(reused.json().error).toBe('BAD_CURSOR');
    });

    it('leaves the legacy array form alone', async () => {
      const rows = await getJson('/api/accio');
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(12);
    });

    // PR #80 review: since the shelf filters on the server, a tag chip is a
    // `tag=` query, and one hand-corrupted `tags` value must not turn it into
    // a 500 — the row degrades to untagged, as `toLink` already shows it.
    it('a corrupt tags value degrades that row to untagged instead of failing the tag filter', async () => {
      const raw = new Database(app.config.storage.dbFile);
      const victim = raw.prepare('SELECT id, tags FROM accio_links WHERE url = ?').get(urls[4]) as {
        id: string;
        tags: string;
      };
      raw.prepare('UPDATE accio_links SET tags = ? WHERE id = ?').run('{not json', victim.id);
      try {
        // This suite caps a page at 5 rows, so `total` is the paged check and
        // the full legacy array is where the row itself is looked for.
        const paged = await inject({ method: 'GET', url: '/api/accio?paged=true&tag=all' });
        expect(paged.statusCode).toBe(200);
        expect(paged.json().total).toBe(11);
        expect(paged.json().tags).toEqual(['all', 'four']);

        const legacy = await inject({ method: 'GET', url: '/api/accio?tag=all&limit=500' });
        expect(legacy.statusCode).toBe(200);
        expect(legacy.json()).toHaveLength(11);
        expect(legacy.json().some((link: { id: string }) => link.id === victim.id)).toBe(false);

        // Unfiltered, the row is still listed — untagged.
        const all: Array<{ id: string; tags: string[] }> = await getJson('/api/accio?limit=500');
        expect(all.find((link) => link.id === victim.id)?.tags).toEqual([]);
      } finally {
        raw.prepare('UPDATE accio_links SET tags = ? WHERE id = ?').run(victim.tags, victim.id);
        raw.close();
      }
    });
  });

  describe('portkey', () => {
    const slugs: string[] = [];

    beforeAll(async () => {
      for (let i = 0; i < 40; i += 1) {
        const slug = `link-${String(i).padStart(2, '0')}`;
        const response = await inject({
          method: 'POST',
          url: '/api/portkey',
          payload: { slug, url: `http://10.0.0.${i + 1}/`, note: i % 2 ? 'odd' : 'even' },
        });
        expect(response.statusCode).toBe(201);
        slugs.push(slug);
      }
    });

    it('keyset pages cover every link once, newest first, across tied timestamps', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let step = 0; step < 50; step += 1) {
        const suffix: string = cursor ? `&cursor=${cursor}` : '';
        const page = await getJson(`/api/portkey?paged=true${suffix}`);
        expect(page.total).toBe(40);
        expect(page.limit).toBe(3);
        seen.push(...page.items.map((link: { slug: string }) => link.slug));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(new Set(seen).size).toBe(40);
      expect([...seen].sort()).toEqual([...slugs].sort());
    });

    it('filters by q with a matching total', async () => {
      const page = await getJson('/api/portkey?paged=true&q=odd');
      expect(page.total).toBe(20);
    });

    it('an insert and a delete between requests cause no duplicate and no skip', async () => {
      const first = await getJson('/api/portkey?paged=true&limit=5');
      const shown: string[] = first.items.map((link: { slug: string }) => link.slug);
      await inject({
        method: 'POST',
        url: '/api/portkey',
        payload: { slug: 'late', url: 'http://10.9.9.9/' },
      });
      const unreached = slugs.find((slug) => !shown.includes(slug)) ?? '';
      await inject({ method: 'DELETE', url: `/api/portkey/${unreached}` });
      let cursor: string | null = first.nextCursor;
      while (cursor) {
        const page = await getJson(`/api/portkey?paged=true&limit=5&cursor=${cursor}`);
        shown.push(...page.items.map((link: { slug: string }) => link.slug));
        cursor = page.nextCursor;
      }
      expect(new Set(shown).size).toBe(shown.length);
      expect([...shown].sort()).toEqual(slugs.filter((slug) => slug !== unreached).sort());
    });

    it('the legacy array still returns more than a page, as `bifrost portkey ls` expects', async () => {
      const rows = await getJson('/api/portkey');
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(30);
    });
  });
});
