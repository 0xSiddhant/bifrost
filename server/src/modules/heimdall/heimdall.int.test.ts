import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

const PIN = '4321';
const BOUNDARY = 'BifrostHeimdallBoundary';

function multipartPayload(name: string, content: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="${name}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

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
    // Seed uploads/ directly, as Finder or an older Bifrost would have: the
    // listing reads the directory, so nothing needs to have been "recorded".
    const uploads = path.join(storageRoot, 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, 'holiday.jpg'), 'x'.repeat(2048));
    // …and one dot-file, which is the OS's, not an upload (criterion 27).
    fs.writeFileSync(path.join(uploads, '.DS_Store'), 'x'.repeat(6144));

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
    const body = stats.json() as {
      uploads: { total: number; today: number };
      disk: { folder: string; bytes: number; files: number }[];
      activity: number[];
    };
    // Counts come from `audit_events` since PLAN-17b, so a file merely sitting
    // on disk is not an "upload" — nothing was ever sent through this server.
    expect(body.uploads).toEqual({ total: 0, today: 0 });
    expect(body.activity).toHaveLength(24);
    // The 6 KB `.DS_Store` must not be counted as stored data either.
    const uploadsUsage = body.disk.find((entry) => entry.folder === 'uploads');
    expect(uploadsUsage).toMatchObject({ files: 1, bytes: 2048 });
  });

  it('counts a real upload in the dashboard figures, sourced from audit_events', async () => {
    const upload = await app.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipartPayload('receipt.pdf', 'pretend pdf'),
    });
    expect(upload.statusCode).toBe(201);

    const stats = await app.fastify.inject({
      method: 'GET',
      url: '/api/heimdall/stats',
      headers: { cookie },
    });
    const body = stats.json() as { uploads: { total: number; today: number }; activity: number[] };
    expect(body.uploads).toEqual({ total: 1, today: 1 });
    // Current hour is the last bucket of the 24h sparkline.
    expect(body.activity[23]).toBe(1);
  });

  it('lists exactly what is in uploads/ right now — no ghosts, no dot-files', async () => {
    const list = async () => {
      const res = await app.fastify.inject({
        method: 'GET',
        url: '/api/heimdall/uploads',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as { total: number; items: { name: string; size: number; mtime: number }[] };
    };

    const before = await list();
    const holiday = before.items.find((item) => item.name === 'holiday.jpg');
    expect(holiday).toMatchObject({ size: 2048 });
    expect(holiday?.mtime).toBeGreaterThan(0);
    expect(before.items.some((item) => item.name === '.DS_Store')).toBe(false);

    // Criterion 17: delete outside the app, and the very next read reflects it.
    // A table could not do this — which is exactly why one was removed.
    fs.rmSync(path.join(storageRoot, 'uploads', 'holiday.jpg'));
    const after = await list();
    expect(after.items.some((item) => item.name === 'holiday.jpg')).toBe(false);
    expect(after.total).toBe(before.total - 1);
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
