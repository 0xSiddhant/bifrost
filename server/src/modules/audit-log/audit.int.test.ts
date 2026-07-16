import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

async function adminCookie(app: RunningApp): Promise<string> {
  const res = await app.fastify.inject({
    method: 'POST',
    url: '/api/heimdall/login',
    payload: { pin: '4321' },
  });
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return header!.split(';')[0]!;
}

describe('audit log over HTTP', () => {
  let app: RunningApp;
  let storageRoot: string;
  let cookie: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-audit-'));
    app = await createApp(loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
    // Logging in itself records a heimdall.login event.
    cookie = await adminCookie(app);
    // And a clipboard post records a clipboard.updated event.
    await app.fastify.inject({ method: 'POST', url: '/api/clipboard', payload: { text: 'audit me' } });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('guards the history endpoint', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/heimdall/audit' });
    expect(res.statusCode).toBe(401);
  });

  it('records events from multiple modules and lists them', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/heimdall/audit',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      total: number;
      items: { event: string; summary: string | null }[];
      events: string[];
    };
    const events = body.items.map((i) => i.event);
    expect(events).toContain('heimdall.login');
    expect(events).toContain('clipboard.updated');
    expect(body.events).toEqual(expect.arrayContaining(['heimdall.login', 'clipboard.updated']));
  });

  it('filters by event type', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/heimdall/audit?event=clipboard.updated',
      headers: { cookie },
    });
    const body = res.json() as { items: { event: string }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.event === 'clipboard.updated')).toBe(true);
  });
});
