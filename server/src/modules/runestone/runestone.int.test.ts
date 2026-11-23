import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import type { RunningApp } from '../../app.js';
import { createTestApp } from '../../testing/app.js';

describe('runestone module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-runestone-'));
    app = await createTestApp({ STORAGE_ROOT: storageRoot, RUNESTONE_MAX_DOC_KB: '1' });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const inject = (opts: InjectOptions) => app.fastify.inject(opts);

  // PLAN-35: the cap is baked into the client from the same .env key at build
  // time, so the server no longer answers a config read. It still enforces it.
  it('no longer serves /api/runestone/config', async () => {
    const response = await inject({ method: 'GET', url: '/api/runestone/config' });
    expect(response.statusCode).toBe(404);
  });

  it('full lifecycle: save → list → fetch by slug → rename (301 old slug) → delete', async () => {
    const save = await inject({
      method: 'POST',
      url: '/api/runestone',
      headers: { 'x-bifrost-device': 'device-alpha' },
      payload: { name: 'Lifecycle Doc', content: '{"v":1}' },
    });
    expect(save.statusCode).toBe(201);
    const created = save.json();
    expect(created.slug).toBe(`lifecycle-doc-${created.id}`);
    expect(created.authorDeviceId).toBe('device-alpha');

    const list = await inject({ method: 'GET', url: '/api/runestone' });
    expect(list.json().some((row: { id: string }) => row.id === created.id)).toBe(true);
    expect(list.json()[0].content).toBeUndefined();

    const bySlug = await inject({ method: 'GET', url: `/api/runestone/${created.slug}` });
    expect(bySlug.statusCode).toBe(200);
    expect(bySlug.json().content).toBe('{"v":1}');

    const rename = await inject({
      method: 'PUT',
      url: `/api/runestone/${created.id}`,
      payload: { name: 'Fresh Name' },
    });
    expect(rename.statusCode).toBe(200);
    const renamed = rename.json();
    expect(renamed.slug).toBe(`fresh-name-${created.id}`);

    // stale-name slug with a valid id → 301 to the canonical slug
    const stale = await inject({ method: 'GET', url: `/api/runestone/${created.slug}` });
    expect(stale.statusCode).toBe(301);
    expect(stale.headers.location).toBe(`/api/v1/runestone/${renamed.slug}`);

    const remove = await inject({ method: 'DELETE', url: `/api/runestone/${created.id}` });
    expect(remove.statusCode).toBe(204);
    const gone = await inject({ method: 'GET', url: `/api/runestone/${renamed.slug}` });
    expect(gone.statusCode).toBe(404);
  });

  it('serves raw document JSON at the public /runestone/api/:slug endpoint', async () => {
    const content = '{\n  "keep": "formatting",\n  "big": 9007199254740993\n}';
    const save = await inject({
      method: 'POST',
      url: '/api/runestone',
      payload: { name: 'Public Data', content },
    });
    const created = save.json();

    const data = await inject({ method: 'GET', url: `/runestone/api/${created.slug}` });
    expect(data.statusCode).toBe(200);
    expect(data.headers['content-type']).toContain('application/json');
    expect(data.headers['access-control-allow-origin']).toBe('*');
    // raw stored text — formatting and >2^53 precision untouched
    expect(data.body).toBe(content);

    const rename = await inject({
      method: 'PUT',
      url: `/api/runestone/${created.id}`,
      payload: { name: 'Public Data v2' },
    });
    const stale = await inject({ method: 'GET', url: `/runestone/api/${created.slug}` });
    expect(stale.statusCode).toBe(301);
    expect(stale.headers.location).toBe(`/runestone/api/v1/${rename.json().slug}`);

    const missing = await inject({ method: 'GET', url: '/runestone/api/never-was-zz9zz9' });
    expect(missing.statusCode).toBe(404);

    await inject({ method: 'DELETE', url: `/api/runestone/${created.id}` });
  });

  it('defaults the name to a relic title when omitted', async () => {
    const save = await inject({
      method: 'POST',
      url: '/api/runestone',
      payload: { content: '{"unnamed":true}' },
    });
    expect(save.statusCode).toBe(201);
    expect(save.json().name).toMatch(/^[^ ]+ .+$/);
    await inject({ method: 'DELETE', url: `/api/runestone/${save.json().id}` });
  });

  it('422s broken JSON and 413s docs over the cap', async () => {
    const broken = await inject({
      method: 'POST',
      url: '/api/runestone',
      payload: { content: '{"a": ' },
    });
    expect(broken.statusCode).toBe(422);
    expect(broken.json().error).toBe('INVALID_JSON');

    const big = await inject({
      method: 'POST',
      url: '/api/runestone',
      payload: { content: JSON.stringify({ pad: 'x'.repeat(2048) }) },
    });
    expect(big.statusCode).toBe(413);
  });

  it('filters, searches, sorts, and paginates the library', async () => {
    const seededIds: string[] = [];
    const docs = [
      { name: 'Alpha Ledger', author: 'device-a', pad: 10 },
      { name: 'Beta Ledger', author: 'device-b', pad: 200 },
      { name: 'Gamma Notes', author: 'device-a', pad: 500 },
    ];
    for (const doc of docs) {
      const response = await inject({
        method: 'POST',
        url: '/api/runestone',
        headers: { 'x-bifrost-device': doc.author },
        payload: { name: doc.name, content: JSON.stringify({ pad: 'x'.repeat(doc.pad) }) },
      });
      expect(response.statusCode).toBe(201);
      seededIds.push(response.json().id);
    }

    const search = await inject({ method: 'GET', url: '/api/runestone?q=ledger' });
    expect(search.json().map((row: { name: string }) => row.name).sort()).toEqual([
      'Alpha Ledger',
      'Beta Ledger',
    ]);

    // LIKE wildcards must not act as wildcards in user input
    const wildcard = await inject({ method: 'GET', url: '/api/runestone?q=%25' });
    expect(wildcard.json()).toEqual([]);

    const byAuthor = await inject({ method: 'GET', url: '/api/runestone?author=device-a' });
    expect(byAuthor.json()).toHaveLength(2);

    const bySize = await inject({ method: 'GET', url: '/api/runestone?sort=size&order=desc' });
    const sizes = bySize.json().map((row: { sizeBytes: number }) => row.sizeBytes);
    expect(sizes).toEqual([...sizes].sort((a: number, b: number) => b - a));

    const page = await inject({ method: 'GET', url: '/api/runestone?sort=name&limit=2&offset=2' });
    expect(page.json().map((row: { name: string }) => row.name)).toEqual(['Gamma Notes']);

    for (const id of seededIds) {
      await inject({ method: 'DELETE', url: `/api/runestone/${id}` });
    }
  });

  describe('formats (PLAN-42)', () => {
    const COMMENTED =
      '{\n  // the port\n  "port": 4646, /* default */\n  "big": 9007199254740993,\n}';

    it("defaults an older client's save to json and stores JSONC byte for byte", async () => {
      const legacy = await inject({
        method: 'POST',
        url: '/api/v1/runestone',
        payload: { name: 'Legacy Client', content: '{"a":1}' },
      });
      expect(legacy.statusCode).toBe(201);
      expect(legacy.json().format).toBe('json');

      const refused = await inject({
        method: 'POST',
        url: '/api/v1/runestone',
        payload: { name: 'Commented As Json', content: COMMENTED },
      });
      expect(refused.statusCode).toBe(422);
      expect(refused.json().error).toBe('INVALID_JSON');

      const jsonc = await inject({
        method: 'POST',
        url: '/api/v1/runestone',
        payload: { name: 'Commented', content: COMMENTED, format: 'jsonc' },
      });
      expect(jsonc.statusCode).toBe(201);
      expect(jsonc.json()).toMatchObject({ format: 'jsonc', content: COMMENTED });

      const read = await inject({ method: 'GET', url: `/api/v1/runestone/${jsonc.json().slug}` });
      expect(read.json()).toMatchObject({ format: 'jsonc', content: COMMENTED });

      const json5 = await inject({
        method: 'POST',
        url: '/api/v1/runestone',
        payload: { content: "{'a': 1}", format: 'jsonc' },
      });
      expect(json5.statusCode).toBe(422);
      const unknown = await inject({
        method: 'POST',
        url: '/api/v1/runestone',
        payload: { content: '{}', format: 'json5' },
      });
      expect(unknown.statusCode).toBe(400);

      for (const id of [legacy.json().id, jsonc.json().id]) {
        await inject({ method: 'DELETE', url: `/api/v1/runestone/${id}` });
      }
    });

    it('keeps the format on an update that omits it, and validates a change', async () => {
      const save = await inject({
        method: 'POST',
        url: '/api/v1/runestone',
        payload: { name: 'Switching', content: COMMENTED, format: 'jsonc' },
      });
      const { id } = save.json();
      const renamed = await inject({
        method: 'PUT',
        url: `/api/v1/runestone/${id}`,
        payload: { name: 'Switched' },
      });
      expect(renamed.json().format).toBe('jsonc');

      const toJson = await inject({
        method: 'PUT',
        url: `/api/v1/runestone/${id}`,
        payload: { format: 'json' },
      });
      expect(toJson.statusCode).toBe(422);

      const stripped = await inject({
        method: 'PUT',
        url: `/api/v1/runestone/${id}`,
        payload: { format: 'json', content: '{"port": 4646}' },
      });
      expect(stripped.statusCode).toBe(200);
      expect(stripped.json().format).toBe('json');

      const back = await inject({
        method: 'PUT',
        url: `/api/v1/runestone/${id}`,
        payload: { format: 'jsonc' },
      });
      expect(back.json()).toMatchObject({ format: 'jsonc', content: '{"port": 4646}' });
      await inject({ method: 'DELETE', url: `/api/v1/runestone/${id}` });
    });

    it("serves each format's media type on the raw URL, with CORS and redirects", async () => {
      const save = await inject({
        method: 'POST',
        url: '/api/v1/runestone',
        payload: { name: 'Raw Commented', content: COMMENTED, format: 'jsonc' },
      });
      const created = save.json();
      const raw = await inject({ method: 'GET', url: `/runestone/api/v1/${created.slug}` });
      expect(raw.statusCode).toBe(200);
      expect(raw.headers['content-type']).toBe('application/jsonc; charset=utf-8');
      expect(raw.headers['access-control-allow-origin']).toBe('*');
      expect(raw.headers.vary).toBe('Accept');
      expect(raw.body).toBe(COMMENTED);

      // A browser navigation gets text it can show, not a download; anything
      // that asks for JSONC, or for anything, still gets JSONC.
      const browser = await inject({
        method: 'GET',
        url: `/runestone/api/v1/${created.slug}`,
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      expect(browser.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(browser.headers['x-content-type-options']).toBe('nosniff');
      expect(browser.body).toBe(COMMENTED);
      for (const accept of ['application/jsonc', '*/*', 'text/html, application/jsonc;q=0.9']) {
        const asked = await inject({
          method: 'GET',
          url: `/runestone/api/v1/${created.slug}`,
          headers: { accept },
        });
        expect(asked.headers['content-type'], accept).toBe('application/jsonc; charset=utf-8');
      }

      const rename = await inject({
        method: 'PUT',
        url: `/api/v1/runestone/${created.id}`,
        payload: { name: 'Raw Commented v2' },
      });
      const stale = await inject({ method: 'GET', url: `/runestone/api/v1/${created.slug}` });
      expect(stale.statusCode).toBe(301);
      expect(stale.headers.location).toBe(`/runestone/api/v1/${rename.json().slug}`);
      expect(stale.headers['access-control-allow-origin']).toBe('*');

      const strict = await inject({
        method: 'PUT',
        url: `/api/v1/runestone/${created.id}`,
        payload: { format: 'json', content: '{"port": 4646}' },
      });
      const json = await inject({
        method: 'GET',
        url: `/runestone/api/v1/${strict.json().slug}`,
      });
      expect(json.headers['content-type']).toBe('application/json; charset=utf-8');
      const jsonInBrowser = await inject({
        method: 'GET',
        url: `/runestone/api/v1/${strict.json().slug}`,
        headers: { accept: 'text/html,*/*;q=0.8' },
      });
      // Strict JSON stays application/json: browsers already render it.
      expect(jsonInBrowser.headers['content-type']).toBe('application/json; charset=utf-8');
      await inject({ method: 'DELETE', url: `/api/v1/runestone/${created.id}` });
    });

    it('filters by format in the legacy list and the paged list, totals included', async () => {
      const ids: string[] = [];
      const seed = [
        { name: 'Fmt Json One', format: 'json', content: '{"n":1}', author: 'device-f' },
        { name: 'Fmt Jsonc One', format: 'jsonc', content: '{"n":2,}', author: 'device-f' },
        { name: 'Fmt Jsonc Two', format: 'jsonc', content: '// c\n[3]', author: 'device-g' },
      ];
      for (const doc of seed) {
        const response = await inject({
          method: 'POST',
          url: '/api/v1/runestone',
          headers: { 'x-bifrost-device': doc.author },
          payload: { name: doc.name, content: doc.content, format: doc.format },
        });
        expect(response.statusCode).toBe(201);
        ids.push(response.json().id);
      }
      const names = (rows: Array<{ name: string }>) => rows.map((row) => row.name).sort();

      const legacy = await inject({ method: 'GET', url: '/api/v1/runestone?q=fmt&format=jsonc' });
      expect(Array.isArray(legacy.json())).toBe(true);
      expect(names(legacy.json())).toEqual(['Fmt Jsonc One', 'Fmt Jsonc Two']);
      expect(legacy.json().every((row: { format: string }) => row.format === 'jsonc')).toBe(true);

      const all = await inject({ method: 'GET', url: '/api/v1/runestone?q=fmt' });
      expect(names(all.json())).toHaveLength(3);

      const paged = await inject({
        method: 'GET',
        url: '/api/v1/runestone?q=fmt&format=jsonc&paged=true&limit=1&sort=name&order=asc',
      });
      expect(paged.json()).toMatchObject({ total: 2, limit: 1, offset: 0 });
      expect(names(paged.json().items)).toEqual(['Fmt Jsonc One']);
      // The author facet stays unfiltered, as it always has.
      expect(paged.json().authors).toEqual(expect.arrayContaining(['device-f', 'device-g']));

      const second = await inject({
        method: 'GET',
        url: '/api/v1/runestone?q=fmt&format=jsonc&paged=true&limit=1&offset=1&sort=name&order=asc',
      });
      expect(names(second.json().items)).toEqual(['Fmt Jsonc Two']);

      const withAuthor = await inject({
        method: 'GET',
        url: '/api/v1/runestone?format=jsonc&author=device-f&paged=true',
      });
      expect(withAuthor.json().total).toBe(1);

      const json = await inject({
        method: 'GET',
        url: '/api/v1/runestone?q=fmt&format=json&paged=true',
      });
      expect(json.json().total).toBe(1);
      expect(json.json().items[0].format).toBe('json');

      const bad = await inject({ method: 'GET', url: '/api/v1/runestone?format=yaml' });
      expect(bad.statusCode).toBe(400);

      for (const id of ids) await inject({ method: 'DELETE', url: `/api/v1/runestone/${id}` });
    });
  });

  it('bus leg works end-to-end: audit-log records saves and deletes', async () => {
    const saved = await inject({
      method: 'POST',
      url: '/api/runestone',
      headers: { 'x-bifrost-device': 'device-audit' },
      payload: { name: 'Bus Probe', content: '{}' },
    });
    expect(saved.statusCode).toBe(201);
    await inject({ method: 'DELETE', url: `/api/runestone/${saved.json().id}` });

    const login = await inject({
      method: 'POST',
      url: '/api/heimdall/login',
      payload: { pin: '4321' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie'];
    const history = await inject({
      method: 'GET',
      url: '/api/heimdall/audit?limit=50',
      headers: { cookie: Array.isArray(cookie) ? cookie.join('; ') : (cookie ?? '') },
    });
    expect(history.statusCode).toBe(200);
    const rows: Array<{ event: string; deviceId: string | null; summary: string | null }> =
      history.json().items ?? [];
    expect(
      rows.some(
        (row) =>
          row.event === 'runestone.saved' &&
          row.deviceId === 'device-audit' &&
          row.summary?.includes('Bus Probe'),
      ),
    ).toBe(true);
    expect(
      rows.some((row) => row.event === 'runestone.deleted' && row.summary?.includes('Bus Probe')),
    ).toBe(true);
  });
});
