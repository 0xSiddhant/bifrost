import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';
import { sessionStreamLive } from './routes/observability.js';

const PIN = '4321';

async function adminCookie(app: RunningApp): Promise<string> {
  const res = await app.fastify.inject({ method: 'POST', url: '/api/heimdall/login', payload: { pin: PIN } });
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const cookie = header ? header.split(';')[0] : null;
  if (!cookie) throw new Error('no session cookie');
  return cookie;
}

describe('heimdall observability (about + logs)', () => {
  let app: RunningApp;
  let storageRoot: string;
  let cookie: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-obs-'));
    app = await createApp(loadConfig({ HEIMDALL_PIN: PIN, STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
    cookie = await adminCookie(app);
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('guards the new endpoints with 401 when no session', async () => {
    const gets = ['/api/heimdall/about', '/api/heimdall/changelog', '/api/heimdall/logs'];
    for (const url of gets) {
      const res = await app.fastify.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
    const patch = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/heimdall/logs/level',
      payload: { level: 'debug' },
    });
    expect(patch.statusCode).toBe(401);
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

  it('returns the log tail shape and the current level', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/heimdall/logs', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { level: string; entries: unknown[]; modules: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(Array.isArray(body.modules)).toBe(true);
    expect(typeof body.level).toBe('string');
  });

  it('changes the runtime log level live', async () => {
    const patch = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/heimdall/logs/level',
      headers: { cookie },
      payload: { level: 'debug' },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { level: string }).level).toBe('debug');

    const after = await app.fastify.inject({ method: 'GET', url: '/api/heimdall/logs', headers: { cookie } });
    expect((after.json() as { level: string }).level).toBe('debug');
  });

  it('rejects an unknown log level', async () => {
    const res = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/heimdall/logs/level',
      headers: { cookie },
      payload: { level: 'loud' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('sessionStreamLive (log-stream per-send gate)', () => {
  const now = 1_000_000;
  it('is live only with a matching epoch and a future expiry', () => {
    expect(sessionStreamLive(3, now + 1000, 3, now)).toBe(true);
  });
  it('drops on an epoch bump (revoke-all)', () => {
    expect(sessionStreamLive(3, now + 1000, 4, now)).toBe(false);
  });
  it('drops once expired', () => {
    expect(sessionStreamLive(3, now - 1, 3, now)).toBe(false);
  });
  it('drops when the session carried no epoch/expiry', () => {
    expect(sessionStreamLive(undefined, undefined, 0, now)).toBe(false);
  });
});
