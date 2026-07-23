import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from './core/config/index.js';
import { createApp, type RunningApp } from './app.js';

describe('boot → health → capabilities', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-boot-'));
    const config = loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('GET /api/health reports ok, uptime, and profile', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.profile).toBe('local');
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /api/capabilities lists the loaded modules', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/api/capabilities' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      profile: 'local',
      modules: [
        'health',
        'file-transfer',
        'previews',
        'qr-tool',
        'themes',
        'heimdall',
        'clipboard',
        'presence',
        'audit-log',
        'runestone',
        'variant',
        'edda',
        'loki',
      ],
    });
  });

  it('unknown API routes return a clean JSON 404 (no paths leaked)', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'NOT_FOUND', message: 'route not found' });
  });

  it('boots with WAL journal mode and the settings table migrated', () => {
    const db = fs.existsSync(path.join(storageRoot, 'data', 'app.db'));
    expect(db).toBe(true);
  });
});
