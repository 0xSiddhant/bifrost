import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

const PIN = '4321';

async function adminCookie(app: RunningApp): Promise<string> {
  const res = await app.fastify.inject({ method: 'POST', url: '/api/heimdall/login', payload: { pin: PIN } });
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const cookie = header ? header.split(';')[0] : null;
  if (!cookie) throw new Error('no session cookie');
  return cookie;
}

describe('heimdall about', () => {
  let app: RunningApp;
  let storageRoot: string;
  let cookie: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-about-'));
    app = await createApp(loadConfig({ HEIMDALL_PIN: PIN, STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
    cookie = await adminCookie(app);
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('guards the endpoints with 401 when no session', async () => {
    for (const url of ['/api/heimdall/about', '/api/heimdall/changelog']) {
      const res = await app.fastify.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('serves about with build + runtime facts', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/heimdall/about', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(typeof body.version).toBe('string');
    expect(typeof body.commit).toBe('string');
    expect(typeof body.node).toBe('string');
    expect(typeof body.host).toBe('string');
    expect(body.profile).toBe('local');
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  it('serves the changelog content', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/heimdall/changelog', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(typeof (res.json() as { content: string }).content).toBe('string');
  });

  // PLAN-16a deleted the Heimdall log viewer, its live stream, and the runtime
  // level switch (acceptance criterion 8). Pinned as a test because a route
  // quietly coming back and a route that was never really removed look
  // identical from the client side.
  it('no longer serves any log route', async () => {
    for (const url of ['/api/heimdall/logs', '/api/heimdall/logs/stream']) {
      const res = await app.fastify.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, url).toBe(404);
    }
    const patch = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/heimdall/logs/level',
      headers: { cookie },
      payload: { level: 'debug' },
    });
    expect(patch.statusCode).toBe(404);
  });
});
