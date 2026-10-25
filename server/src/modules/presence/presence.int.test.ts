import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RunningApp } from '../../app.js';
import type { PresenceDevice } from '../../core/bus/events.js';
import { createTestApp } from '../../testing/app.js';

/**
 * The presence routes end to end (PLAN-32c): a device appears by holding the
 * event stream open, so this suite listens on a real port and keeps one open,
 * while the contract guard runs strict over every answer.
 */

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('presence', () => {
  let app: RunningApp;
  let stream: http.ClientRequest;

  const devices = async (): Promise<PresenceDevice[]> =>
    (await app.fastify.inject('/api/presence')).json<{ devices: PresenceDevice[] }>().devices;

  beforeAll(async () => {
    app = await createTestApp();
    await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.fastify.server.address() as AddressInfo;
    stream = http.get({
      host: '127.0.0.1',
      port,
      path: '/api/events?deviceId=device-kitchen',
      headers: { 'user-agent': IPHONE_UA },
    });
    await vi.waitFor(async () => expect(await devices()).toHaveLength(1));
  });

  afterAll(async () => {
    stream.destroy();
    await app.shutdown();
    fs.rmSync(app.config.storage.root, { recursive: true, force: true });
  });

  it('lists a device holding the event stream as online, with an alias and a UA label', async () => {
    const [device] = await devices();
    expect(device).toMatchObject({ deviceId: 'device-kitchen', name: null, online: true });
    expect(device?.label).toContain('iPhone');
    expect(typeof device?.charName).toBe('string');
    expect(device?.lastSeen).toBeGreaterThan(0);
  });

  it('claims a trimmed name, clears it with null, and refuses an unknown device', async () => {
    const claim = (payload: object) =>
      app.fastify.inject({ method: 'PATCH', url: '/api/presence/name', payload });

    const named = await claim({ deviceId: 'device-kitchen', name: '  Kitchen iPad  ' });
    expect(named.statusCode).toBe(200);
    expect(named.json<{ devices: PresenceDevice[] }>().devices[0]?.name).toBe('Kitchen iPad');

    const cleared = await claim({ deviceId: 'device-kitchen', name: null });
    expect(cleared.json<{ devices: PresenceDevice[] }>().devices[0]?.name).toBeNull();

    expect((await claim({ deviceId: 'nobody', name: 'x' })).statusCode).toBe(404);
    expect((await claim({ name: 'no device id' })).statusCode).toBe(400);
  });

  it('prunes nothing that is online', async () => {
    const response = await app.fastify.inject({ method: 'POST', url: '/api/presence/prune' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      removed: 0,
      devices: [{ deviceId: 'device-kitchen' }],
    });
  });

  it('shows the device offline once its stream closes', async () => {
    stream.destroy();
    await vi.waitFor(async () => expect((await devices())[0]?.online).toBe(false));
  });
});
