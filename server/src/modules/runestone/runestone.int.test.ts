import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { InjectOptions } from 'fastify';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

describe('runestone module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-runestone-'));
    const config = loadConfig({
      HEIMDALL_PIN: '4321',
      STORAGE_ROOT: storageRoot,
      RUNESTONE_MAX_DOC_KB: '1',
    });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const inject = (opts: InjectOptions) => app.fastify.inject(opts);

  it('exposes the doc-size cap so the client never hardcodes it', async () => {
    const response = await inject({ method: 'GET', url: '/api/runestone/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ maxDocKb: 1 });
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
    expect(stale.headers.location).toBe(`/api/runestone/${renamed.slug}`);

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
    expect(stale.headers.location).toBe(`/runestone/api/${rename.json().slug}`);

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
