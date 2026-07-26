import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { InjectOptions } from 'fastify';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';
import type { Portkey } from '../../core/bus/events.js';

/** Let any post-redirect setImmediate hit-writes flush before we assert on them. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('portkey module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-portkey-'));
    const config = loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const inject = (opts: InjectOptions) => app.fastify.inject(opts);
  const create = (payload: Record<string, unknown>, device = 'device-alpha') =>
    inject({ method: 'POST', url: '/api/portkey', headers: { 'x-bifrost-device': device }, payload });

  it('advertises the module in capabilities', async () => {
    const response = await inject({ method: 'GET', url: '/api/capabilities' });
    expect(response.json().modules).toContain('portkey');
  });

  it('full lifecycle: create → list → edit → delete', async () => {
    const made = await create({ slug: 'router', url: '192.168.1.1', note: 'admin panel' });
    expect(made.statusCode).toBe(201);
    const created = made.json() as Portkey;
    expect(created).toMatchObject({
      slug: 'router',
      url: 'https://192.168.1.1/',
      note: 'admin panel',
      hits: 0,
      authorDeviceId: 'device-alpha',
      lastUsedAt: null,
    });

    const list = await inject({ method: 'GET', url: '/api/portkey' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Portkey[]).some((row) => row.slug === 'router')).toBe(true);

    const edit = await inject({
      method: 'PATCH',
      url: '/api/portkey/router',
      payload: { url: 'http://10.0.0.1', note: '' },
    });
    expect(edit.statusCode).toBe(200);
    expect((edit.json() as Portkey).url).toBe('http://10.0.0.1/');
    expect((edit.json() as Portkey).note).toBeNull();

    const remove = await inject({ method: 'DELETE', url: '/api/portkey/router' });
    expect(remove.statusCode).toBe(204);
    const gone = await inject({ method: 'PATCH', url: '/api/portkey/router', payload: { note: 'x' } });
    expect(gone.statusCode).toBe(404);
  });

  it('/go/:slug 302s to the target with no-store, and counts the hit async', async () => {
    await create({ slug: 'nas', url: 'http://nas.local/photos' });

    const hop = await inject({ method: 'GET', url: '/go/nas' });
    expect(hop.statusCode).toBe(302);
    expect(hop.headers.location).toBe('http://nas.local/photos');
    // 302 (never 301) + no-store: a moved target must never stick in caches.
    expect(hop.headers['cache-control']).toBe('no-store');

    // The hit is bumped AFTER the redirect is sent — flush the microtask queue,
    // then it's visible.
    await flush();
    await flush();
    const after = await inject({ method: 'GET', url: '/api/portkey?q=nas' });
    const row = (after.json() as Portkey[]).find((p) => p.slug === 'nas');
    expect(row?.hits).toBe(1);
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('unknown slug bounces to the pre-filled enchant form (creative 404)', async () => {
    const miss = await inject({ method: 'GET', url: '/go/never-enchanted' });
    expect(miss.statusCode).toBe(302);
    expect(miss.headers.location).toBe('/portkey?go=never-enchanted');
  });

  it('the /go route wins over the SPA fallback / catch-all', async () => {
    await create({ slug: 'wins', url: 'http://wins.local' });
    // A registered /go route answers a redirect — never the SPA fallback (which,
    // when a client build is present, would serve index.html with 200) nor a
    // catch-all 404. That precedence is the whole point of registering it.
    const hop = await inject({ method: 'GET', url: '/go/wins' });
    expect(hop.statusCode).toBe(302);
    expect(hop.headers.location).toBe('http://wins.local/');
    // An unknown /api path stays a clean JSON 404 regardless of the client build.
    const api = await inject({ method: 'GET', url: '/api/nope' });
    expect(api.statusCode).toBe(404);
  });

  it('409/422 matrix: duplicate, reserved, bad slug, bad scheme', async () => {
    await create({ slug: 'printer', url: 'printer.local' });

    const dup = await create({ slug: 'printer', url: 'other.local' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('CONFLICT');

    const reserved = await create({ slug: 'go', url: 'x.com' });
    expect(reserved.statusCode).toBe(422);

    const api = await create({ slug: 'api', url: 'x.com' });
    expect(api.statusCode).toBe(422);

    const badSlug = await create({ slug: 'Bad Slug', url: 'x.com' });
    expect(badSlug.statusCode).toBe(422);

    const badScheme = await create({ slug: 'evil', url: 'javascript:alert(1)' });
    expect(badScheme.statusCode).toBe(422);
  });
});
