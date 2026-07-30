import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import pino from 'pino';
import type { InjectOptions } from 'fastify';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';
import type { NimbusResult } from '../../core/bus/events.js';

const MAX_TEST_MB = 8;

describe('nimbus module', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-nimbus-'));
    const config = loadConfig({
      HEIMDALL_PIN: '4321',
      STORAGE_ROOT: storageRoot,
      // A small ceiling keeps the byte-count assertions fast; the arithmetic is
      // identical at 100 MB.
      NIMBUS_MAX_TEST_MB: String(MAX_TEST_MB),
    });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const inject = (opts: InjectOptions) => app.fastify.inject(opts);
  const device = (id: string) => ({ 'x-bifrost-device': id });
  /** Hands the guard back so each test starts from a free server. */
  const release = (id: string) =>
    inject({ method: 'POST', url: '/api/nimbus/release', headers: device(id) });

  beforeEach(async () => {
    for (const id of ['device-alpha', 'device-beta']) await release(id);
  });

  it('advertises the module in capabilities', async () => {
    const response = await inject({ method: 'GET', url: '/api/capabilities' });
    expect(response.json().modules).toContain('nimbus');
  });

  it('serves the configured limits so the page never hardcodes a menu', async () => {
    const response = await inject({ method: 'GET', url: '/api/nimbus/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      maxTestMb: MAX_TEST_MB,
      sizes: [MAX_TEST_MB],
      pingSamples: 10,
      busy: false,
      holder: null,
      since: null,
    });
  });

  it('answers ping with an empty, uncacheable 204', async () => {
    const response = await inject({ method: 'GET', url: '/api/nimbus/ping' });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  describe('download', () => {
    it('streams exactly the requested bytes, uncompressed and uncacheable', async () => {
      const response = await inject({
        method: 'GET',
        url: '/api/nimbus/down?mb=2',
        headers: device('device-alpha'),
      });

      const expected = 2 * 1024 * 1024;
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers['content-length']).toBe(String(expected));
      // Acceptance 2: identity encoding on the wire — nothing compressed the
      // payload into a flattering number.
      expect(response.headers['content-encoding']).toBe('identity');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.rawPayload.length).toBe(expected);
    });

    it('sends data a compressor cannot shrink', async () => {
      const response = await inject({
        method: 'GET',
        url: '/api/nimbus/down?mb=1',
        headers: device('device-alpha'),
      });
      const body = response.rawPayload;
      expect(gzipSync(body).length).toBeGreaterThan(body.length * 0.95);
    });

    it('clamps a request above the configured ceiling', async () => {
      const response = await inject({
        method: 'GET',
        url: '/api/nimbus/down?mb=999',
        headers: device('device-alpha'),
      });
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload.length).toBe(MAX_TEST_MB * 1024 * 1024);
    });

    it('400s a size that is not a usable number', async () => {
      const response = await inject({
        method: 'GET',
        url: '/api/nimbus/down?mb=abc',
        headers: device('device-alpha'),
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('upload', () => {
    const body = (bytes: number) => Buffer.alloc(bytes, 7);

    it('counts and times the bytes, and writes nothing to disk', async () => {
      const before = du(storageRoot);

      const response = await inject({
        method: 'POST',
        url: '/api/nimbus/up',
        headers: { ...device('device-alpha'), 'content-type': 'application/octet-stream' },
        payload: body(3 * 1024 * 1024),
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { bytes: number; ms: number };
      expect(json.bytes).toBe(3 * 1024 * 1024);
      expect(json.ms).toBeGreaterThanOrEqual(0);
      // Acceptance 4: the sink is a counter, so storage is byte-for-byte
      // unchanged by an upload test.
      expect(du(storageRoot)).toBe(before);
    });

    it('413s a body past the configured cap, before reading it', async () => {
      const response = await inject({
        method: 'POST',
        url: '/api/nimbus/up',
        headers: { ...device('device-alpha'), 'content-type': 'application/octet-stream' },
        payload: body((MAX_TEST_MB + 1) * 1024 * 1024),
      });
      expect(response.statusCode).toBe(413);
      expect(response.json().error).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('single-flight guard', () => {
    it('turns a second device away instead of corrupting both numbers', async () => {
      const first = await inject({
        method: 'GET',
        url: '/api/nimbus/down?mb=1',
        headers: device('device-alpha'),
      });
      expect(first.statusCode).toBe(200);

      // Inside device-alpha's grace window, device-beta is told to wait.
      const down = await inject({
        method: 'GET',
        url: '/api/nimbus/down?mb=1',
        headers: device('device-beta'),
      });
      expect(down.statusCode).toBe(409);
      expect(down.json().error).toBe('TEST_IN_PROGRESS');
      expect(down.json().message).toContain('another broom is flying');

      // The upload leg is guarded too — and answers 409 without reading a body.
      const up = await inject({
        method: 'POST',
        url: '/api/nimbus/up',
        headers: { ...device('device-beta'), 'content-type': 'application/octet-stream' },
        payload: Buffer.alloc(1024),
      });
      expect(up.statusCode).toBe(409);

      // The holder itself continues through its remaining phases.
      const ownUp = await inject({
        method: 'POST',
        url: '/api/nimbus/up',
        headers: { ...device('device-alpha'), 'content-type': 'application/octet-stream' },
        payload: Buffer.alloc(1024),
      });
      expect(ownUp.statusCode).toBe(200);
    });

    it('never blocks a ping, so a busy server is still reachable', async () => {
      await inject({ method: 'GET', url: '/api/nimbus/down?mb=1', headers: device('device-alpha') });
      const ping = await inject({ method: 'GET', url: '/api/nimbus/ping', headers: device('device-beta') });
      expect(ping.statusCode).toBe(204);
    });

    it('frees the guard the moment a client releases it (the cancel path)', async () => {
      await inject({ method: 'GET', url: '/api/nimbus/down?mb=1', headers: device('device-alpha') });
      const busy = await inject({ method: 'GET', url: '/api/nimbus/config' });
      expect(busy.json().busy).toBe(true);

      const released = await release('device-alpha');
      expect(released.statusCode).toBe(204);

      const free = await inject({ method: 'GET', url: '/api/nimbus/config' });
      expect(free.json().busy).toBe(false);
      const next = await inject({
        method: 'GET',
        url: '/api/nimbus/down?mb=1',
        headers: device('device-beta'),
      });
      expect(next.statusCode).toBe(200);
    });
  });

  describe('results', () => {
    const post = (payload: Record<string, unknown>, id = 'device-alpha') =>
      inject({ method: 'POST', url: '/api/nimbus/results', headers: device(id), payload });

    it('saves a result attributed to the posting device and lists it back', async () => {
      const saved = await post({ downMbps: 240.5, upMbps: 110.25, latencyMs: 4.5, testMb: 8 });
      expect(saved.statusCode).toBe(201);
      const result = saved.json() as NimbusResult;
      expect(result.deviceId).toBe('device-alpha');
      expect(result.downMbps).toBe(240.5);

      await post({ downMbps: 12, upMbps: 8, latencyMs: 30, testMb: 1 }, 'device-beta');

      const all = await inject({ method: 'GET', url: '/api/nimbus/results' });
      expect(all.statusCode).toBe(200);
      expect((all.json() as NimbusResult[]).length).toBeGreaterThanOrEqual(2);

      const mine = await inject({ method: 'GET', url: '/api/nimbus/results?device=device-beta' });
      const rows = mine.json() as NimbusResult[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.downMbps).toBe(12);
    });

    it('422s an implausible measurement and 400s a malformed body', async () => {
      const nonsense = await post({ downMbps: -5, upMbps: 1, latencyMs: 1, testMb: 1 });
      expect(nonsense.statusCode).toBe(422);

      const oversize = await post({ downMbps: 1, upMbps: 1, latencyMs: 1, testMb: 999 });
      expect(oversize.statusCode).toBe(422);

      const malformed = await post({ downMbps: 1 });
      expect(malformed.statusCode).toBe(400);
    });

    it('records the completed test in the audit log', async () => {
      await post({ downMbps: 333, upMbps: 222, latencyMs: 5, testMb: 8 }, 'device-audited');

      const login = await inject({
        method: 'POST',
        url: '/api/heimdall/login',
        payload: { pin: '4321' },
      });
      const cookie = login.headers['set-cookie'];
      const audit = await inject({
        method: 'GET',
        url: '/api/heimdall/audit?event=nimbus.completed',
        headers: { cookie: Array.isArray(cookie) ? cookie.join('; ') : String(cookie) },
      });
      expect(audit.statusCode).toBe(200);
      const items = (audit.json() as { items: Array<{ deviceId: string; summary: string }> }).items;
      const mine = items.find((item) => item.deviceId === 'device-audited');
      expect(mine?.summary).toContain('333');
    });
  });
});

/** Total bytes of every file under a directory — the "nothing was written" probe. */
function du(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += du(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}
