import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildHttp } from './index.js';

/**
 * PLAN-36 criterion 4: behind the web host, request.ip must still be each
 * device's own address (the login throttle, presence, upload attribution,
 * client-log relays and Nimbus all key on it), and a forged X-Forwarded-For
 * must change nothing unless it really came from the loopback web host.
 */
let app: FastifyInstance | null = null;

async function echoApp(): Promise<FastifyInstance> {
  app = await buildHttp({ logger: pino({ level: 'silent' }) });
  app.get('/api/ip', async (request) => ({ ip: request.ip }));
  return app;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('trustProxy is loopback-only', () => {
  it('believes X-Forwarded-For from the loopback web host', async () => {
    const http = await echoApp();
    const response = await http.inject({
      url: '/api/ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '192.168.1.23' },
    });
    expect(response.json()).toEqual({ ip: '192.168.1.23' });
  });

  it('ignores X-Forwarded-For from anywhere else', async () => {
    const http = await echoApp();
    const response = await http.inject({
      url: '/api/ip',
      remoteAddress: '192.168.1.50',
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    expect(response.json()).toEqual({ ip: '192.168.1.50' });
  });

  it('takes the last untrusted hop, so a client cannot prepend a fake one', async () => {
    const http = await echoApp();
    const response = await http.inject({
      url: '/api/ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '6.6.6.6, 192.168.1.23' },
    });
    expect(response.json()).toEqual({ ip: '192.168.1.23' });
  });

  it('answers an unknown path with a JSON 404, never a client page (the web host serves those)', async () => {
    const http = await echoApp();
    const response = await http.inject({ url: '/runestone' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});
