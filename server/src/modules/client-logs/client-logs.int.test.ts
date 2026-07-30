import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { LEVEL_FORMATTER } from '../../core/logger/index.js';
import { createApp, type RunningApp } from '../../app.js';

/** Everything the app writes, parsed — the point of this module is the output. */
const written: Record<string, unknown>[] = [];

function captureLogger(): pino.Logger {
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) written.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return pino({ level: 'trace', formatters: LEVEL_FORMATTER }, destination);
}

const relayed = (): Record<string, unknown>[] => written.filter((line) => line.source === 'client');

describe('client-logs', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-clientlogs-'));
    app = await createApp(
      loadConfig({
        HEIMDALL_PIN: '4321',
        STORAGE_ROOT: storageRoot,
        // Small enough that one oversized report trips it, roomy enough that a
        // schema-invalid entry still reaches the schema (the body limit fires
        // first, so an over-tight cap here would 413 the 400 cases).
        CLIENT_LOG_MAX_BODY_KB: '4',
        CLIENT_LOG_MAX_BATCH: '3',
        // Comfortably above what the tests below spend, so only the flood test
        // at the end trips it — the limit is per IP and every case shares one.
        CLIENT_LOG_RATE_LIMIT_PER_MIN: '20',
      }),
      { logger: captureLogger() },
    );
  });

  afterAll(async () => {
    await app.shutdown('test over');
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('serves the floor and batch cap publicly', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/client-logs/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ level: 'warn', maxBatch: 3 });
  });

  it('re-emits a batch through pino as source=client with the device and route', async () => {
    written.length = 0;
    const res = await app.fastify.inject({
      method: 'POST',
      url: '/api/client-logs',
      headers: { 'x-bifrost-device': 'dev-abc' },
      payload: {
        entries: [
          { level: 'error', msg: 'render blew up', module: 'accio', route: '/accio', stack: 'at X' },
          { level: 'warn', msg: 'upload retry', module: 'file-transfer', route: '/send' },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 2, dropped: 0 });

    const lines = relayed();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      source: 'client',
      module: 'accio',
      logLevel: 'error',
      deviceId: 'dev-abc',
      route: '/accio',
      stack: 'at X',
      msg: 'render blew up',
    });
    expect(lines[1]).toMatchObject({ module: 'file-transfer', logLevel: 'warn' });
  });

  // The label is the whole point: `{module="accio"}` has to return the browser
  // and the server halves of the feature, so the client value must be the plain
  // feature name — not `client-logs`, the module that happens to relay it.
  it('attributes lines to the reporting feature, not to client-logs', async () => {
    written.length = 0;
    await app.fastify.inject({
      method: 'POST',
      url: '/api/client-logs',
      payload: { entries: [{ level: 'error', msg: 'boom', module: 'accio' }] },
    });
    expect(relayed()[0]).toMatchObject({ module: 'accio' });
  });

  it('falls back to module=app for reports that belong to no page', async () => {
    written.length = 0;
    await app.fastify.inject({
      method: 'POST',
      url: '/api/client-logs',
      payload: { entries: [{ level: 'error', msg: 'shell crash' }] },
    });
    expect(relayed()[0]).toMatchObject({ module: 'app' });
  });

  // Criterion 16a — a duplicate key is silent and only shows up as a
  // mislabelled panel, so it is asserted on the real serialized line.
  it('never writes two source keys on a relayed line', async () => {
    written.length = 0;
    await app.fastify.inject({
      method: 'POST',
      url: '/api/client-logs',
      payload: { entries: [{ level: 'error', msg: 'boom', module: 'accio' }] },
    });
    const line = relayed()[0];
    expect(JSON.stringify(line).match(/"source"/g)).toHaveLength(1);
  });

  it('drops entries below the configured floor without failing the batch', async () => {
    written.length = 0;
    const res = await app.fastify.inject({
      method: 'POST',
      url: '/api/client-logs',
      payload: {
        entries: [
          { level: 'debug', msg: 'chatter', module: 'accio' },
          { level: 'error', msg: 'real', module: 'accio' },
        ],
      },
    });
    expect(res.json()).toEqual({ accepted: 1, dropped: 1 });
    expect(relayed().map((line) => line.msg)).toEqual(['real']);
  });

  it('rejects a batch over the entry cap', async () => {
    const res = await app.fastify.inject({
      method: 'POST',
      url: '/api/client-logs',
      payload: {
        entries: Array.from({ length: 4 }, () => ({ level: 'error' as const, msg: 'x' })),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown level and an over-long message', async () => {
    const bad = await app.fastify.inject({
      method: 'POST',
      url: '/api/client-logs',
      payload: { entries: [{ level: 'loud', msg: 'x' }] },
    });
    expect(bad.statusCode).toBe(400);

    const long = await app.fastify.inject({
      method: 'POST',
      url: '/api/client-logs',
      payload: { entries: [{ level: 'error', msg: 'x'.repeat(2001) }] },
    });
    expect(long.statusCode).toBe(400);
  });

  it('rejects an oversized body with 413', async () => {
    const res = await app.fastify.inject({
      method: 'POST',
      url: '/api/client-logs',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        entries: [{ level: 'error', msg: 'x'.repeat(1500), stack: 'y'.repeat(4000) }],
      }),
    });
    expect(res.statusCode).toBe(413);
  });

  // Runs last: it burns the per-minute allowance for this IP.
  it('rate-limits a flood so one tab cannot fill the log folder', async () => {
    let limited = 0;
    for (let i = 0; i < 30; i += 1) {
      const res = await app.fastify.inject({
        method: 'POST',
        url: '/api/client-logs',
        payload: { entries: [{ level: 'error', msg: `flood ${i}`, module: 'accio' }] },
      });
      if (res.statusCode === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
