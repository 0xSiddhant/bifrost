import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';
import { EventBus } from '../../core/bus/index.js';
import { checkpointAndClose, openDb, runMigrations, type DbHandle } from '../../core/db/index.js';
import type { ModuleDeps } from '../../core/module.js';
import type { OfflineModeConfig } from '../../core/bus/events.js';
import { offlineModeModule } from './module.js';

const PIN = '4321';

async function login(app: RunningApp): Promise<string> {
  const res = await app.fastify.inject({
    method: 'POST',
    url: '/api/heimdall/login',
    payload: { pin: PIN },
  });
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return header ? (header.split(';')[0] ?? '') : '';
}

const getConfig = async (app: RunningApp): Promise<OfflineModeConfig> => {
  const res = await app.fastify.inject({ method: 'GET', url: '/api/offline-mode/config' });
  expect(res.statusCode).toBe(200);
  return res.json() as OfflineModeConfig;
};

describe('offline-mode module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-offline-mode-'));
    app = await createApp(loadConfig({ HEIMDALL_PIN: PIN, STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('is advertised as a capability', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/capabilities' });
    expect((res.json() as { modules: string[] }).modules).toContain('offline-mode');
  });

  it('serves the whole registry with nothing disabled by default', async () => {
    const config = await getConfig(app);
    expect(config.targets.map((target) => target.id)).toEqual([
      'toolbox',
      'runestone',
      'groot',
      'edda',
      'variant',
      'loki',
    ]);
    expect(config.targets.every((target) => target.label.length > 0)).toBe(true);
    expect(config.disabled).toEqual([]);
  });

  it('requires an admin session to change the policy', async () => {
    const res = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/offline-mode/settings',
      payload: { id: 'loki', enabled: false },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown id and a malformed body, writing neither', async () => {
    const cookie = await login(app);
    const unknown = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/offline-mode/settings',
      headers: { cookie },
      payload: { id: 'pensieve', enabled: false },
    });
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { error: string }).error).toBe('UNKNOWN_TARGET');

    const malformed = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/offline-mode/settings',
      headers: { cookie },
      payload: { id: 'loki' },
    });
    expect(malformed.statusCode).toBe(400);

    expect((await getConfig(app)).disabled).toEqual([]);
  });

  it('persists a disable and re-enables cleanly, always in registry order', async () => {
    const cookie = await login(app);

    const disable = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/offline-mode/settings',
      headers: { cookie },
      payload: { id: 'loki', enabled: false },
    });
    expect(disable.statusCode).toBe(200);
    expect((disable.json() as OfflineModeConfig).disabled).toEqual(['loki']);
    expect((await getConfig(app)).disabled).toEqual(['loki']);

    // Disabled ids are stored in registry order, not click order.
    await app.fastify.inject({
      method: 'PATCH',
      url: '/api/offline-mode/settings',
      headers: { cookie },
      payload: { id: 'toolbox', enabled: false },
    });
    expect((await getConfig(app)).disabled).toEqual(['toolbox', 'loki']);

    const reEnable = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/offline-mode/settings',
      headers: { cookie },
      payload: { id: 'loki', enabled: true },
    });
    expect((reEnable.json() as OfflineModeConfig).disabled).toEqual(['toolbox']);

    await app.fastify.inject({
      method: 'PATCH',
      url: '/api/offline-mode/settings',
      headers: { cookie },
      payload: { id: 'toolbox', enabled: true },
    });
    expect((await getConfig(app)).disabled).toEqual([]);
  });
});

/**
 * The live-rebind half. Mounted standalone (bare Fastify, open guard, real bus,
 * recording hub) because the composed app owns its bus privately — this is the
 * only place the `offlineMode.settingsUpdated` emit → SSE fan-out is visible.
 */
describe('offline-mode broadcast', () => {
  let storageRoot: string;
  let handle: DbHandle;

  beforeAll(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-offline-bus-'));
    handle = openDb(path.join(storageRoot, 'app.db'));
    runMigrations(handle);
  });

  afterAll(() => {
    checkpointAndClose(handle);
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('emits on the bus and fans the same payload out over SSE', async () => {
    const bus = new EventBus();
    const emitted: OfflineModeConfig[] = [];
    const broadcast: { event: string; payload: unknown }[] = [];
    bus.on('offlineMode.settingsUpdated', (payload) => emitted.push(payload));

    const app = Fastify();
    app.decorate('requireAdmin', (_request: unknown, _reply: unknown, done: () => void) => done());
    await app.register(async (scope) => {
      offlineModeModule.register(scope, {
        db: handle,
        bus,
        sse: {
          broadcast: (event: string, payload: unknown) => broadcast.push({ event, payload }),
        },
        log: pino({ level: 'silent' }),
      } as unknown as ModuleDeps);
    });
    await app.ready();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/offline-mode/settings',
      payload: { id: 'edda', enabled: false },
    });
    expect(res.statusCode).toBe(200);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.disabled).toEqual(['edda']);
    expect(broadcast).toEqual([{ event: 'offlineMode.settingsUpdated', payload: emitted[0] }]);

    await app.close();
  });
});
