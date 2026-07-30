import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { openDb, checkpointAndClose, type DbHandle } from '../../core/db/index.js';
import { EventBus } from '../../core/bus/index.js';
import { SseHub } from '../../core/sse/index.js';
import { AuthService } from '../../core/auth/index.js';
import type { Logger } from '../../core/logger/index.js';
import { fileTransferModule } from './module.js';

/**
 * The full live-update chain on a real temp folder: chokidar sees a change →
 * watcher emits on the bus → module wiring relays to the SSE hub. Slowness is
 * real too — awaitWriteFinish holds events ~1.5s to debounce half-copied files.
 */
describe('downloads watcher → bus → sse', () => {
  const app = Fastify();
  const bus = new EventBus();
  const sse = new SseHub();
  const broadcast = vi.spyOn(sse, 'broadcast');
  let storageRoot: string;
  let db: DbHandle;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-watch-'));
    const config = loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot });
    for (const dir of Object.values(config.storage)) {
      if (!dir.endsWith('.db')) fs.mkdirSync(dir, { recursive: true });
    }
    db = openDb(config.storage.dbFile);
    const log: Logger = pino({ level: 'silent' });
    const auth = new AuthService('4321', 0, () => {});
    await app.register(async (scope) => {
      await fileTransferModule.register(scope, {
        config,
        log,
        db,
        bus,
        sse,
        auth,
        clientLog: () => log,
      });
    });
    await app.ready();
  }, 20_000);

  afterAll(async () => {
    await app.close();
    checkpointAndClose(db);
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('broadcasts download.added when a file lands in downloads/', async () => {
    fs.writeFileSync(path.join(storageRoot, 'downloads', 'dropped.txt'), 'via finder');

    await vi.waitFor(
      () => {
        expect(broadcast).toHaveBeenCalledWith(
          'download.added',
          expect.objectContaining({ name: 'dropped.txt', size: 10, ext: '.txt' }),
        );
      },
      { timeout: 10_000, interval: 200 },
    );

    const listing = await app.inject({ method: 'GET', url: '/api/downloads' });
    expect(listing.json()).toHaveLength(1);
  }, 15_000);

  it('broadcasts download.changed when the file grows', async () => {
    fs.appendFileSync(path.join(storageRoot, 'downloads', 'dropped.txt'), ' — updated');

    await vi.waitFor(
      () => {
        expect(broadcast).toHaveBeenCalledWith(
          'download.changed',
          expect.objectContaining({ name: 'dropped.txt' }),
        );
      },
      { timeout: 10_000, interval: 200 },
    );
  }, 15_000);

  it('broadcasts download.removed and drops it from the listing on delete', async () => {
    fs.rmSync(path.join(storageRoot, 'downloads', 'dropped.txt'));

    await vi.waitFor(
      () => {
        expect(broadcast).toHaveBeenCalledWith(
          'download.removed',
          expect.objectContaining({ name: 'dropped.txt' }),
        );
      },
      { timeout: 10_000, interval: 200 },
    );

    const listing = await app.inject({ method: 'GET', url: '/api/downloads' });
    expect(listing.json()).toEqual([]);
  }, 15_000);

  /**
   * PLAN-17b: publishing fires `file.published` immediately, and chokidar fires
   * `download.added` later. Both reach SSE — the split is deliberate, and the
   * client bans anything from bannering on the second one (or every published
   * file would announce itself twice).
   */
  it('broadcasts file.published with the origin device, then download.added', async () => {
    fs.writeFileSync(path.join(storageRoot, 'uploads', 'moved.txt'), 'staged');
    broadcast.mockClear();

    const res = await app.inject({
      method: 'POST',
      url: '/api/files/moved.txt/publish',
      headers: { 'x-bifrost-device': 'device-a' },
    });
    expect(res.statusCode).toBe(200);

    expect(broadcast).toHaveBeenCalledWith(
      'file.published',
      expect.objectContaining({ name: 'moved.txt', size: 6, originDeviceId: 'device-a' }),
    );

    await vi.waitFor(
      () => {
        expect(broadcast).toHaveBeenCalledWith(
          'download.added',
          expect.objectContaining({ name: 'moved.txt' }),
        );
      },
      { timeout: 10_000, interval: 200 },
    );
    // Exactly one banner event for one published file.
    const publishedCalls = broadcast.mock.calls.filter(([event]) => event === 'file.published');
    expect(publishedCalls).toHaveLength(1);
  }, 15_000);

  it('carries a null origin when no device header was sent', async () => {
    fs.writeFileSync(path.join(storageRoot, 'uploads', 'anon.txt'), 'staged');
    broadcast.mockClear();

    await app.inject({ method: 'POST', url: '/api/files/anon.txt/publish' });

    // Null, not omitted: the client filter must tell "unknown sender" from
    // "me", and show the banner in the first case.
    expect(broadcast).toHaveBeenCalledWith(
      'file.published',
      expect.objectContaining({ originDeviceId: null }),
    );
  }, 15_000);
});
