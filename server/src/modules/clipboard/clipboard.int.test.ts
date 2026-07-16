import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const post = (app: RunningApp, body: Record<string, unknown>, deviceId?: string) =>
  app.fastify.inject({
    method: 'POST',
    url: '/api/clipboard',
    payload: body,
    headers: deviceId ? { 'x-bifrost-device': deviceId } : {},
  });

const list = async (app: RunningApp) =>
  (await app.fastify.inject({ method: 'GET', url: '/api/clipboard' })).json() as {
    id: string;
    text: string;
    deviceId: string | null;
  }[];

describe('clipboard over HTTP', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = tmp('bifrost-clip-');
    app = await createApp(
      loadConfig({
        HEIMDALL_PIN: '4321',
        STORAGE_ROOT: storageRoot,
        CLIPBOARD_MAX_ENTRIES: '3',
        CLIPBOARD_MAX_TEXT_KB: '1',
      }),
      { logger: pino({ level: 'silent' }) },
    );
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('adds an entry attributed to the posting device and lists it', async () => {
    const res = await post(app, { text: 'shared link' }, 'mac-1');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ text: 'shared link', kind: 'text', deviceId: 'mac-1' });

    const entries = await list(app);
    expect(entries[0]).toMatchObject({ text: 'shared link', deviceId: 'mac-1' });
  });

  it('rejects an oversize entry with 413', async () => {
    const res = await post(app, { text: 'x'.repeat(2000) });
    expect(res.statusCode).toBe(413);
  });

  it('deletes an entry, then 404s a second delete', async () => {
    const created = (await post(app, { text: 'to remove' })).json() as { id: string };
    const del = await app.fastify.inject({ method: 'DELETE', url: `/api/clipboard/${created.id}` });
    expect(del.statusCode).toBe(204);
    const gone = await app.fastify.inject({ method: 'DELETE', url: `/api/clipboard/${created.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it('evicts the oldest once past the cap', async () => {
    // Clear the board first.
    for (const entry of await list(app)) {
      await app.fastify.inject({ method: 'DELETE', url: `/api/clipboard/${entry.id}` });
    }
    for (const text of ['a', 'b', 'c', 'd']) await post(app, { text });
    const entries = await list(app);
    expect(entries).toHaveLength(3); // cap is 3
    expect(entries.map((e) => e.text)).not.toContain('a'); // oldest gone
  });
});

describe('clipboard survives restart', () => {
  it('entries persist across a fresh boot with no torn rows', async () => {
    const storageRoot = tmp('bifrost-clip-restart-');
    const config = () =>
      loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot, CLIPBOARD_MAX_ENTRIES: '100' });

    const first = await createApp(config(), { logger: pino({ level: 'silent' }) });
    for (let i = 0; i < 25; i += 1) await post(first, { text: `entry ${i}` });
    const before = await list(first);
    await first.shutdown();

    const second = await createApp(config(), { logger: pino({ level: 'silent' }) });
    try {
      const after = await list(second);
      expect(after).toHaveLength(before.length);
      expect(after.every((e) => typeof e.text === 'string' && e.text.startsWith('entry '))).toBe(true);
    } finally {
      await second.shutdown();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
