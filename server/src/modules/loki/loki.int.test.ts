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

describe('loki module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-loki-'));
    app = await createApp(loadConfig({ HEIMDALL_PIN: PIN, STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('serves effective execution config with the .env defaults', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/loki/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      executionEnabled: true,
      fetchAllowed: true,
      runTimeoutMs: 5000,
      consoleMaxEntries: 500,
      timeoutMin: 250,
      timeoutMax: 30000,
    });
  });

  it('requires an admin session to change settings', async () => {
    const res = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/loki/settings',
      payload: { executionEnabled: false },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty patch and out-of-range values', async () => {
    const cookie = await login(app);
    const empty = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/loki/settings',
      headers: { cookie },
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const bad = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/loki/settings',
      headers: { cookie },
      payload: { runTimeoutMs: 999999 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('persists an admin patch and reflects it on the public config', async () => {
    const cookie = await login(app);
    const patch = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/loki/settings',
      headers: { cookie },
      payload: { executionEnabled: false, fetchAllowed: false, runTimeoutMs: 3000, consoleMaxEntries: 100 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({
      executionEnabled: false,
      fetchAllowed: false,
      runTimeoutMs: 3000,
      consoleMaxEntries: 100,
    });

    const after = await app.fastify.inject({ method: 'GET', url: '/api/loki/config' });
    expect(after.json()).toMatchObject({ executionEnabled: false, runTimeoutMs: 3000 });
  });
});
