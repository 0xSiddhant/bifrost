import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { InjectOptions } from 'fastify';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';
import type { AccioLink } from '../../core/bus/events.js';

describe('accio module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-accio-'));
    const config = loadConfig({
      HEIMDALL_PIN: '4321',
      STORAGE_ROOT: storageRoot,
      // Keep the (unreachable, in tests) title lookup from holding shutdown up.
      ACCIO_TITLE_TIMEOUT_MS: '150',
    });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const inject = (opts: InjectOptions) => app.fastify.inject(opts);
  const saveLink = (payload: Record<string, unknown>, device = 'device-alpha') =>
    inject({ method: 'POST', url: '/api/accio', headers: { 'x-bifrost-device': device }, payload });

  it('advertises the module in capabilities', async () => {
    const response = await inject({ method: 'GET', url: '/api/capabilities' });
    expect(response.json().modules).toContain('accio');
  });

  it('full lifecycle: save → list → edit → delete', async () => {
    const save = await saveLink({ url: 'example.com/read-me', title: 'Read Me', tags: ['Later'] });
    expect(save.statusCode).toBe(201);
    const created = save.json() as AccioLink;
    expect(created.url).toBe('https://example.com/read-me');
    expect(created.tags).toEqual(['later']);
    expect(created.authorDeviceId).toBe('device-alpha');

    const list = await inject({ method: 'GET', url: '/api/accio' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as AccioLink[]).some((row) => row.id === created.id)).toBe(true);

    const edit = await inject({
      method: 'PATCH',
      url: `/api/accio/${created.id}`,
      payload: { title: 'Renamed', tags: ['later', 'recipes'] },
    });
    expect(edit.statusCode).toBe(200);
    expect((edit.json() as AccioLink).title).toBe('Renamed');
    expect((edit.json() as AccioLink).tags).toEqual(['later', 'recipes']);

    const remove = await inject({ method: 'DELETE', url: `/api/accio/${created.id}` });
    expect(remove.statusCode).toBe(204);

    const gone = await inject({ method: 'PATCH', url: `/api/accio/${created.id}`, payload: { title: 'x' } });
    expect(gone.statusCode).toBe(404);
  });

  it('422s the schemes that would execute in the page', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:msgbox(1)']) {
      const response = await saveLink({ url });
      expect(response.statusCode, url).toBe(422);
    }
  });

  it('shelves any other scheme as an ordinary link', async () => {
    const saved = await saveLink({ url: 'chrome://chrome-urls/', tags: ['browser'] });
    expect(saved.statusCode).toBe(201);
    expect((saved.json() as AccioLink).url).toBe('chrome://chrome-urls/');

    const dns = await saveLink({ url: 'chrome://net-internals/#dns' });
    expect((dns.json() as AccioLink).url).toBe('chrome://net-internals/#dns');

    const mail = await saveLink({ url: 'mailto:someone@example.com' });
    expect(mail.statusCode).toBe(201);
  });

  it('400s a body that violates the schema', async () => {
    // Missing required url.
    expect((await saveLink({})).statusCode).toBe(400);
    // Past the schema bounds (the usecase's own normalizers never see these).
    expect(
      (await saveLink({ url: 'example.com', tags: Array.from({ length: 20 }, (_u, i) => `t${i}`) }))
        .statusCode,
    ).toBe(400);
    expect((await saveLink({ url: 'example.com', title: 'x'.repeat(500) })).statusCode).toBe(400);
    // PATCH with nothing to change.
    const empty = await inject({ method: 'PATCH', url: '/api/accio/whatever', payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it('search and tag filter compose', async () => {
    await saveLink({ url: 'https://cooking.example/pasta', title: 'Perfect Pasta', tags: ['recipes'] });
    await saveLink({ url: 'https://cooking.example/bread', title: 'Sourdough', tags: ['recipes'] });
    await saveLink({ url: 'https://work.example/pasta-report', title: 'Q3 Pasta Report', tags: ['work'] });

    const byTag = await inject({ method: 'GET', url: '/api/accio?tag=recipes' });
    const tagged = byTag.json() as AccioLink[];
    expect(tagged).toHaveLength(2);

    const composed = await inject({ method: 'GET', url: '/api/accio?tag=recipes&q=pasta' });
    const both = composed.json() as AccioLink[];
    expect(both).toHaveLength(1);
    expect(both[0]?.title).toBe('Perfect Pasta');

    // Search spans the URL too, so a half-remembered domain finds the row.
    const byUrl = await inject({ method: 'GET', url: '/api/accio?q=work.example' });
    expect((byUrl.json() as AccioLink[])[0]?.title).toBe('Q3 Pasta Report');
  });

  it('an exact tag match never matches a longer tag', async () => {
    await saveLink({ url: 'https://tags.example/one', tags: ['js'] });
    await saveLink({ url: 'https://tags.example/two', tags: ['jsdoc'] });

    const js = await inject({ method: 'GET', url: '/api/accio?tag=js' });
    const urls = (js.json() as AccioLink[]).map((row) => row.url);
    expect(urls).toContain('https://tags.example/one');
    expect(urls).not.toContain('https://tags.example/two');
  });

  it('records save and delete in the audit log, but not title enrichment', async () => {
    const created = (await saveLink({ url: 'https://audit.example/x', title: 'Audited' })).json() as AccioLink;
    await inject({ method: 'PATCH', url: `/api/accio/${created.id}`, payload: { tags: ['seen'] } });
    await inject({ method: 'DELETE', url: `/api/accio/${created.id}` });

    const login = await inject({ method: 'POST', url: '/api/heimdall/login', payload: { pin: '4321' } });
    const raw = login.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(';')[0] ?? '';

    const audit = await inject({ method: 'GET', url: '/api/heimdall/audit?limit=500', headers: { cookie } });
    expect(audit.statusCode).toBe(200);
    const items = (audit.json() as { items: Array<{ event: string; summary: string | null }> }).items;
    const accio = items.filter((row) => row.event.startsWith('accio.'));

    expect(accio.some((row) => row.event === 'accio.saved' && row.summary?.includes('Audited'))).toBe(true);
    expect(accio.some((row) => row.event === 'accio.deleted')).toBe(true);
    // Enrichment patches rows constantly; auditing every one would drown the log.
    expect(accio.some((row) => row.event === 'accio.updated')).toBe(false);
  });
});

/**
 * Acceptance criterion 1, both halves: a reachable page's title patches itself
 * in shortly after the row exists, and an unreachable one never blocks or
 * fails the save. A real loopback HTTP server stands in for "the internet" so
 * the fetcher, the module's detached trigger, and the event are all exercised.
 */
describe('accio title enrichment', () => {
  let app: RunningApp;
  let storageRoot: string;
  let site: http.Server;
  let siteUrl: string;

  beforeAll(async () => {
    site = http.createServer((request, response) => {
      if (request.url === '/plain') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<html><head><title>Summoned &amp; Shelved</title></head><body>hi</body></html>');
        return;
      }
      if (request.url === '/not-html') {
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end('%PDF-1.4');
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    const address = site.address();
    siteUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-accio-title-'));
    app = await createApp(
      loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot, ACCIO_TITLE_TIMEOUT_MS: '500' }),
      { logger: pino({ level: 'silent' }) },
    );
  });

  afterAll(async () => {
    await app.shutdown();
    await new Promise<void>((resolve) => site.close(() => resolve()));
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const save = (url: string) =>
    app.fastify.inject({ method: 'POST', url: '/api/accio', payload: { url } });

  /** Polls the row until the async patch lands, or the deadline passes. */
  async function titleOf(id: string, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const list = (await app.fastify.inject({ method: 'GET', url: '/api/accio' })).json() as AccioLink[];
      const row = list.find((link) => link.id === id);
      if (row?.title) return row.title;
      if (Date.now() > deadline) return row?.title ?? null;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it('patches in a reachable page title after the row already exists', async () => {
    const response = await save(`${siteUrl}/plain`);
    expect(response.statusCode).toBe(201);
    const created = response.json() as AccioLink;
    // The save itself is never allowed to carry the title.
    expect(created.title).toBeNull();

    expect(await titleOf(created.id, 5000)).toBe('Summoned & Shelved');
  });

  it('leaves the bare URL when the site is unreachable, without failing the save', async () => {
    const started = Date.now();
    const response = await save('https://nothing-here.invalid/page');
    expect(response.statusCode).toBe(201);
    // The point of the whole design: an unreachable host costs the save nothing.
    expect(Date.now() - started).toBeLessThan(500);

    const created = response.json() as AccioLink;
    expect(await titleOf(created.id, 1500)).toBeNull();
  });

  it('does not try to read a title out of a non-HTML response', async () => {
    const created = (await save(`${siteUrl}/not-html`)).json() as AccioLink;
    expect(await titleOf(created.id, 1500)).toBeNull();
  });
});
