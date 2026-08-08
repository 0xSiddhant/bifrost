import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { InjectOptions } from 'fastify';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

describe('groot module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-groot-'));
    const config = loadConfig({
      HEIMDALL_PIN: '4321',
      STORAGE_ROOT: storageRoot,
      GROOT_MAX_DOC_KB: '1',
    });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const inject = (opts: InjectOptions) => app.fastify.inject(opts);

  it('exposes the doc-size cap', async () => {
    const response = await inject({ method: 'GET', url: '/api/groot/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ maxDocKb: 1 });
  });

  it('full lifecycle: save → list → fetch by slug → rename (301 old slug) → delete', async () => {
    const save = await inject({
      method: 'POST',
      url: '/api/groot',
      headers: { 'x-bifrost-device': 'device-alpha' },
      payload: { name: 'Lifecycle Doc', content: '# Title\n\nBody.' },
    });
    expect(save.statusCode).toBe(201);
    const created = save.json();
    expect(created.slug).toBe(`lifecycle-doc-${created.id}`);
    expect(created.authorDeviceId).toBe('device-alpha');

    const list = await inject({ method: 'GET', url: '/api/groot' });
    expect(list.json().some((row: { id: string }) => row.id === created.id)).toBe(true);
    expect(list.json()[0].content).toBeUndefined();

    const bySlug = await inject({ method: 'GET', url: `/api/groot/${created.slug}` });
    expect(bySlug.statusCode).toBe(200);
    expect(bySlug.json().content).toBe('# Title\n\nBody.');

    const rename = await inject({
      method: 'PUT',
      url: `/api/groot/${created.id}`,
      payload: { name: 'Fresh Name' },
    });
    expect(rename.statusCode).toBe(200);
    const renamed = rename.json();
    expect(renamed.slug).toBe(`fresh-name-${created.id}`);

    const stale = await inject({ method: 'GET', url: `/api/groot/${created.slug}` });
    expect(stale.statusCode).toBe(301);
    expect(stale.headers.location).toBe(`/api/groot/${renamed.slug}`);

    const remove = await inject({ method: 'DELETE', url: `/api/groot/${created.id}` });
    expect(remove.statusCode).toBe(204);
    const gone = await inject({ method: 'GET', url: `/api/groot/${renamed.slug}` });
    expect(gone.statusCode).toBe(404);
  });

  it('serves raw yaml at /groot/api/:slug with CORS, 301, 404 and ?download=1', async () => {
    // Comments and quoting style are part of what was saved — the endpoint
    // hands back stored bytes, never a re-serialization.
    const content = '# a comment\nname: public   # trailing\nversion: "1.10"\n';
    const save = await inject({
      method: 'POST',
      url: '/api/groot',
      payload: { name: 'Public Doc', content },
    });
    const created = save.json();

    const data = await inject({ method: 'GET', url: `/groot/api/${created.slug}` });
    expect(data.statusCode).toBe(200);
    expect(data.headers['content-type']).toContain('application/yaml');
    expect(data.headers['access-control-allow-origin']).toBe('*');
    expect(data.body).toBe(content);

    const download = await inject({ method: 'GET', url: `/groot/api/${created.slug}?download=1` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toBe('attachment; filename="Public Doc.yaml"');

    const rename = await inject({
      method: 'PUT',
      url: `/api/groot/${created.id}`,
      payload: { name: 'Public Doc v2' },
    });
    const stale = await inject({ method: 'GET', url: `/groot/api/${created.slug}` });
    expect(stale.statusCode).toBe(301);
    expect(stale.headers.location).toBe(`/groot/api/${rename.json().slug}`);
    // download flag survives the 301
    const staleDl = await inject({ method: 'GET', url: `/groot/api/${created.slug}?download=1` });
    expect(staleDl.headers.location).toBe(`/groot/api/${rename.json().slug}?download=1`);

    const missing = await inject({ method: 'GET', url: '/groot/api/never-was-zz9zz9' });
    expect(missing.statusCode).toBe(404);

    await inject({ method: 'DELETE', url: `/api/groot/${created.id}` });
  });

  /**
   * The server stores text and never parses YAML — see the usecase for why
   * (alias expansion is a billion-laughs amplifier, so a byte cap does not
   * bound a parse). These pin that decision rather than leaving it implicit,
   * because "the server validates it" is the natural thing to assume.
   */
  describe('the server never parses YAML', () => {
    it('stores and returns a document that does not parse', async () => {
      // A tab in indentation — a hard syntax error the editor refuses to save.
      const content = 'a:\n\tb: 1\n';
      const save = await inject({
        method: 'POST',
        url: '/api/groot',
        payload: { name: 'Broken', content },
      });
      expect(save.statusCode).toBe(201);

      const raw = await inject({ method: 'GET', url: `/groot/api/${save.json().slug}` });
      expect(raw.body).toBe(content);

      await inject({ method: 'DELETE', url: `/api/groot/${save.json().id}` });
    });

    it('accepts an alias bomb without expanding it', async () => {
      const bomb = [
        'a: &a ["x","x","x","x","x","x","x","x","x"]',
        'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
        'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
        'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
        'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
        'f: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e]',
        'g: [*f,*f,*f,*f,*f,*f,*f,*f,*f]',
        '',
      ].join('\n');
      const save = await inject({
        method: 'POST',
        url: '/api/groot',
        payload: { name: 'Bomb', content: bomb },
      });
      // Under 1 KB, so the cap would never have caught it — the point is that
      // nothing here ever tries to expand it.
      expect(save.statusCode).toBe(201);
      expect(save.json().sizeBytes).toBeLessThan(1024);

      await inject({ method: 'DELETE', url: `/api/groot/${save.json().id}` });
    });
  });

  // The raw endpoint lives outside /api/, so it has to beat the SPA fallback.
  it('routes /groot/api/:slug ahead of the SPA fallback', async () => {
    const save = await inject({
      method: 'POST',
      url: '/api/groot',
      payload: { name: 'Precedence', content: 'a: 1\n' },
    });
    const raw = await inject({ method: 'GET', url: `/groot/api/${save.json().slug}` });
    expect(raw.headers['content-type']).not.toContain('text/html');
    expect(raw.body).toBe('a: 1\n');

    await inject({ method: 'DELETE', url: `/api/groot/${save.json().id}` });
  });

  it('defaults the name to a relic title when omitted', async () => {
    const save = await inject({
      method: 'POST',
      url: '/api/groot',
      payload: { content: 'unnamed' },
    });
    expect(save.statusCode).toBe(201);
    expect(save.json().name).toMatch(/^[^ ]+ .+$/);
    await inject({ method: 'DELETE', url: `/api/groot/${save.json().id}` });
  });

  it('413s docs over the cap', async () => {
    const big = await inject({
      method: 'POST',
      url: '/api/groot',
      payload: { content: 'x'.repeat(2048) },
    });
    expect(big.statusCode).toBe(413);
  });

  it('filters, searches, sorts, and paginates the library', async () => {
    const seededIds: string[] = [];
    const docs = [
      { name: 'Alpha Saga', author: 'device-a', pad: 10 },
      { name: 'Beta Saga', author: 'device-b', pad: 200 },
      { name: 'Gamma Notes', author: 'device-a', pad: 500 },
    ];
    for (const doc of docs) {
      const response = await inject({
        method: 'POST',
        url: '/api/groot',
        headers: { 'x-bifrost-device': doc.author },
        payload: { name: doc.name, content: 'x'.repeat(doc.pad) },
      });
      expect(response.statusCode).toBe(201);
      seededIds.push(response.json().id);
    }

    const search = await inject({ method: 'GET', url: '/api/groot?q=saga' });
    expect(search.json().map((row: { name: string }) => row.name).sort()).toEqual([
      'Alpha Saga',
      'Beta Saga',
    ]);

    const wildcard = await inject({ method: 'GET', url: '/api/groot?q=%25' });
    expect(wildcard.json()).toEqual([]);

    const byAuthor = await inject({ method: 'GET', url: '/api/groot?author=device-a' });
    expect(byAuthor.json()).toHaveLength(2);

    const bySize = await inject({ method: 'GET', url: '/api/groot?sort=size&order=desc' });
    const sizes = bySize.json().map((row: { sizeBytes: number }) => row.sizeBytes);
    expect(sizes).toEqual([...sizes].sort((a: number, b: number) => b - a));

    const page = await inject({ method: 'GET', url: '/api/groot?sort=name&limit=2&offset=2' });
    expect(page.json().map((row: { name: string }) => row.name)).toEqual(['Gamma Notes']);

    for (const id of seededIds) {
      await inject({ method: 'DELETE', url: `/api/groot/${id}` });
    }
  });

  it('bus leg works end-to-end: audit-log records saves and deletes', async () => {
    const saved = await inject({
      method: 'POST',
      url: '/api/groot',
      headers: { 'x-bifrost-device': 'device-audit' },
      payload: { name: 'Bus Probe', content: '# hi' },
    });
    expect(saved.statusCode).toBe(201);
    await inject({ method: 'DELETE', url: `/api/groot/${saved.json().id}` });

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
          row.event === 'groot.saved' &&
          row.deviceId === 'device-audit' &&
          row.summary?.includes('Bus Probe'),
      ),
    ).toBe(true);
    expect(
      rows.some((row) => row.event === 'groot.deleted' && row.summary?.includes('Bus Probe')),
    ).toBe(true);
  });
});
