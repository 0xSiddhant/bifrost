import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

const PIN = '4321';

async function login(app: RunningApp): Promise<string> {
  const res = await app.fastify.inject({ method: 'POST', url: '/api/heimdall/login', payload: { pin: PIN } });
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return header ? (header.split(';')[0] ?? '') : '';
}

describe('screensaver module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-screensaver-'));
    app = await createApp(loadConfig({ HEIMDALL_PIN: PIN, STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('serves effective screensaver config with the .env defaults', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/screensaver/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabled: true,
      idleSeconds: 5,
      density: 'medium',
      motion: 'normal',
      connectLines: true,
      mouseReactive: true,
      showQuotes: true,
      quoteRotateSeconds: 14,
      idleMin: 5,
      idleMax: 3600,
      rotateMin: 4,
      rotateMax: 120,
    });
  });

  it('requires an admin session to change settings', async () => {
    const res = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/screensaver/settings',
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty patch and out-of-range / invalid values', async () => {
    const cookie = await login(app);
    const empty = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/screensaver/settings',
      headers: { cookie },
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const tooLong = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/screensaver/settings',
      headers: { cookie },
      payload: { idleSeconds: 999999 },
    });
    expect(tooLong.statusCode).toBe(400);

    const badEnum = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/screensaver/settings',
      headers: { cookie },
      payload: { density: 'ultra' },
    });
    expect(badEnum.statusCode).toBe(400);
  });

  it('persists an admin patch and reflects it on the public config', async () => {
    const cookie = await login(app);
    const patch = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/screensaver/settings',
      headers: { cookie },
      payload: { enabled: false, idleSeconds: 120, density: 'high', motion: 'calm', showQuotes: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({
      enabled: false,
      idleSeconds: 120,
      density: 'high',
      motion: 'calm',
      showQuotes: false,
    });

    const after = await app.fastify.inject({ method: 'GET', url: '/api/screensaver/config' });
    expect(after.json()).toMatchObject({ enabled: false, idleSeconds: 120, density: 'high' });
  });
});
