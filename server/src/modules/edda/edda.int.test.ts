import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { InjectOptions } from 'fastify';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

describe('edda module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-edda-'));
    const config = loadConfig({
      HEIMDALL_PIN: '4321',
      STORAGE_ROOT: storageRoot,
      EDDA_MAX_DOC_KB: '1',
    });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const inject = (opts: InjectOptions) => app.fastify.inject(opts);

  it('exposes the doc-size cap and live-preview threshold', async () => {
    const response = await inject({ method: 'GET', url: '/api/edda/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ maxDocKb: 1, livePreviewMaxKb: 300 });
  });

  it('full lifecycle: save → list → fetch by slug → rename (301 old slug) → delete', async () => {
    const save = await inject({
      method: 'POST',
      url: '/api/edda',
      headers: { 'x-bifrost-device': 'device-alpha' },
      payload: { name: 'Lifecycle Doc', content: '# Title\n\nBody.' },
    });
    expect(save.statusCode).toBe(201);
    const created = save.json();
    expect(created.slug).toBe(`lifecycle-doc-${created.id}`);
    expect(created.authorDeviceId).toBe('device-alpha');

    const list = await inject({ method: 'GET', url: '/api/edda' });
    expect(list.json().some((row: { id: string }) => row.id === created.id)).toBe(true);
    expect(list.json()[0].content).toBeUndefined();

    const bySlug = await inject({ method: 'GET', url: `/api/edda/${created.slug}` });
    expect(bySlug.statusCode).toBe(200);
    expect(bySlug.json().content).toBe('# Title\n\nBody.');

    const rename = await inject({
      method: 'PUT',
      url: `/api/edda/${created.id}`,
      payload: { name: 'Fresh Name' },
    });
    expect(rename.statusCode).toBe(200);
    const renamed = rename.json();
    expect(renamed.slug).toBe(`fresh-name-${created.id}`);

    const stale = await inject({ method: 'GET', url: `/api/edda/${created.slug}` });
    expect(stale.statusCode).toBe(301);
    expect(stale.headers.location).toBe(`/api/edda/${renamed.slug}`);

    const remove = await inject({ method: 'DELETE', url: `/api/edda/${created.id}` });
    expect(remove.statusCode).toBe(204);
    const gone = await inject({ method: 'GET', url: `/api/edda/${renamed.slug}` });
    expect(gone.statusCode).toBe(404);
  });

  it('serves raw markdown at /edda/api/:slug with CORS, 301, 404 and ?download=1', async () => {
    const content = '# Public\n\nRaw *markdown* stays exactly as written.';
    const save = await inject({
      method: 'POST',
      url: '/api/edda',
      payload: { name: 'Public Doc', content },
    });
    const created = save.json();

    const data = await inject({ method: 'GET', url: `/edda/api/${created.slug}` });
    expect(data.statusCode).toBe(200);
    expect(data.headers['content-type']).toContain('text/markdown');
    expect(data.headers['access-control-allow-origin']).toBe('*');
    expect(data.body).toBe(content);

    const download = await inject({ method: 'GET', url: `/edda/api/${created.slug}?download=1` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toBe('attachment; filename="Public Doc.md"');

    const rename = await inject({
      method: 'PUT',
      url: `/api/edda/${created.id}`,
      payload: { name: 'Public Doc v2' },
    });
    const stale = await inject({ method: 'GET', url: `/edda/api/${created.slug}` });
    expect(stale.statusCode).toBe(301);
    expect(stale.headers.location).toBe(`/edda/api/${rename.json().slug}`);
    // download flag survives the 301
    const staleDl = await inject({ method: 'GET', url: `/edda/api/${created.slug}?download=1` });
    expect(staleDl.headers.location).toBe(`/edda/api/${rename.json().slug}?download=1`);

    const missing = await inject({ method: 'GET', url: '/edda/api/never-was-zz9zz9' });
    expect(missing.statusCode).toBe(404);

    await inject({ method: 'DELETE', url: `/api/edda/${created.id}` });
  });

  it('defaults the name to a relic title when omitted', async () => {
    const save = await inject({
      method: 'POST',
      url: '/api/edda',
      payload: { content: 'unnamed' },
    });
    expect(save.statusCode).toBe(201);
    expect(save.json().name).toMatch(/^[^ ]+ .+$/);
    await inject({ method: 'DELETE', url: `/api/edda/${save.json().id}` });
  });

  it('413s docs over the cap', async () => {
    const big = await inject({
      method: 'POST',
      url: '/api/edda',
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
        url: '/api/edda',
        headers: { 'x-bifrost-device': doc.author },
        payload: { name: doc.name, content: 'x'.repeat(doc.pad) },
      });
      expect(response.statusCode).toBe(201);
      seededIds.push(response.json().id);
    }

    const search = await inject({ method: 'GET', url: '/api/edda?q=saga' });
    expect(search.json().map((row: { name: string }) => row.name).sort()).toEqual([
      'Alpha Saga',
      'Beta Saga',
    ]);

    const wildcard = await inject({ method: 'GET', url: '/api/edda?q=%25' });
    expect(wildcard.json()).toEqual([]);

    const byAuthor = await inject({ method: 'GET', url: '/api/edda?author=device-a' });
    expect(byAuthor.json()).toHaveLength(2);

    const bySize = await inject({ method: 'GET', url: '/api/edda?sort=size&order=desc' });
    const sizes = bySize.json().map((row: { sizeBytes: number }) => row.sizeBytes);
    expect(sizes).toEqual([...sizes].sort((a: number, b: number) => b - a));

    const page = await inject({ method: 'GET', url: '/api/edda?sort=name&limit=2&offset=2' });
    expect(page.json().map((row: { name: string }) => row.name)).toEqual(['Gamma Notes']);

    for (const id of seededIds) {
      await inject({ method: 'DELETE', url: `/api/edda/${id}` });
    }
  });

  it('bus leg works end-to-end: audit-log records saves and deletes', async () => {
    const saved = await inject({
      method: 'POST',
      url: '/api/edda',
      headers: { 'x-bifrost-device': 'device-audit' },
      payload: { name: 'Bus Probe', content: '# hi' },
    });
    expect(saved.statusCode).toBe(201);
    await inject({ method: 'DELETE', url: `/api/edda/${saved.json().id}` });

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
          row.event === 'edda.saved' &&
          row.deviceId === 'device-audit' &&
          row.summary?.includes('Bus Probe'),
      ),
    ).toBe(true);
    expect(
      rows.some((row) => row.event === 'edda.deleted' && row.summary?.includes('Bus Probe')),
    ).toBe(true);
  });
});
