import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

const PIN = '4321';

async function login(app: RunningApp, pin = PIN): Promise<{ status: number; cookie: string | null }> {
  const res = await app.fastify.inject({
    method: 'POST',
    url: '/api/heimdall/login',
    payload: { pin },
  });
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return { status: res.statusCode, cookie: header ? (header.split(';')[0] ?? null) : null };
}

function tmpStorage(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('heimdall auth guard + session', () => {
  let app: RunningApp;
  let storageRoot: string;
  let cookie: string;

  beforeAll(async () => {
    storageRoot = tmpStorage('bifrost-heimdall-');
    // Seed an upload as if PLAN-02 testing had left one behind.
    const uploads = path.join(storageRoot, 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, '1700000000000-holiday.jpg'), 'x'.repeat(2048));

    app = await createApp(loadConfig({ HEIMDALL_PIN: PIN, STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('guards settings/stats/uploads/session with 401 when no session', async () => {
    for (const url of [
      '/api/heimdall/settings',
      '/api/heimdall/stats',
      '/api/heimdall/uploads',
      '/api/heimdall/session',
    ]) {
      const res = await app.fastify.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('exposes the entry gesture config publicly (no session)', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/heimdall/access' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ shortcut: 'shift+meta+comma', tapCount: 7 });
  });

  it('rejects a wrong PIN and accepts the right one', async () => {
    const bad = await login(app, '0000');
    expect(bad.status).toBe(401);

    const good = await login(app);
    expect(good.status).toBe(200);
    expect(good.cookie).toBeTruthy();
    cookie = good.cookie!;
  });

  it('serves guarded routes once authenticated', async () => {
    const session = await app.fastify.inject({
      method: 'GET',
      url: '/api/heimdall/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);

    const stats = await app.fastify.inject({
      method: 'GET',
      url: '/api/heimdall/stats',
      headers: { cookie },
    });
    expect(stats.statusCode).toBe(200);
    const body = stats.json() as { uploads: { total: number }; disk: unknown[] };
    expect(body.uploads.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.disk)).toBe(true);
  });

  it('shows upload metadata but exposes no content route', async () => {
    const uploads = await app.fastify.inject({
      method: 'GET',
      url: '/api/heimdall/uploads',
      headers: { cookie },
    });
    expect(uploads.statusCode).toBe(200);
    const body = uploads.json() as { total: number; items: { name: string }[] };
    expect(body.items.some((item) => item.name === 'holiday.jpg')).toBe(true);

    // Uploads are write-only by construction — no read route anywhere.
    const content = await app.fastify.inject({ method: 'GET', url: '/api/uploads' });
    expect(content.statusCode).toBe(404);
  });

  it('round-trips a settings change', async () => {
    const res = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/heimdall/settings',
      headers: { cookie },
      payload: { tapCount: 5, shortcut: 'ctrl+alt+h' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tapCount: 5, shortcut: 'ctrl+alt+h' });

    const access = await app.fastify.inject({ method: 'GET', url: '/api/heimdall/access' });
    expect(access.json()).toMatchObject({ tapCount: 5, shortcut: 'ctrl+alt+h' });
  });

  it('rejects an invalid settings patch', async () => {
    const res = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/heimdall/settings',
      headers: { cookie },
      payload: { shortcut: 'meta+w' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('revoke invalidates the live session', async () => {
    const revoke = await app.fastify.inject({
      method: 'POST',
      url: '/api/heimdall/revoke',
      headers: { cookie },
    });
    expect(revoke.statusCode).toBe(204);

    const after = await app.fastify.inject({
      method: 'GET',
      url: '/api/heimdall/session',
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('heimdall login rate limit', () => {
  it('locks out after 5 failed attempts', async () => {
    const storageRoot = tmpStorage('bifrost-heimdall-rl-');
    const app = await createApp(loadConfig({ HEIMDALL_PIN: PIN, STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await login(app, 'wrong');
        expect(res.status).toBe(401);
      }
      const locked = await login(app, 'wrong');
      expect(locked.status).toBe(429);
      // Even the correct PIN is refused while locked out.
      const correct = await login(app);
      expect(correct.status).toBe(429);
    } finally {
      await app.shutdown();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('heimdall settings persist across restart', () => {
  it('a persisted shortcut survives a fresh boot', async () => {
    const storageRoot = tmpStorage('bifrost-heimdall-persist-');
    const first = await createApp(loadConfig({ HEIMDALL_PIN: PIN, STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
    const { cookie } = await login(first);
    await first.fastify.inject({
      method: 'PATCH',
      url: '/api/heimdall/settings',
      headers: { cookie: cookie! },
      payload: { shortcut: 'ctrl+alt+k' },
    });
    await first.shutdown();

    const second = await createApp(loadConfig({ HEIMDALL_PIN: PIN, STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
    try {
      const access = await second.fastify.inject({ method: 'GET', url: '/api/heimdall/access' });
      expect(access.json()).toMatchObject({ shortcut: 'ctrl+alt+k' });
    } finally {
      await second.shutdown();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
