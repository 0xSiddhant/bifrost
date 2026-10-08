import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildWebHost, PROXIED_ROOTS } from './host.js';

/**
 * The web host in front of a stand-in API (PLAN-36 criteria 3–5): what it
 * forwards, what it serves itself, and what it says while the API is down.
 */

const silent = pino({ level: 'silent' });
let clientDir: string;
let standaloneDir: string;
let upstream: FastifyInstance | null = null;
/** When the stand-in API last saw an upload cut off before its end. */
let uploadCutAt: number | null = null;
let host: FastifyInstance | null = null;

function writeTree(dir: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

beforeAll(() => {
  clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-web-hub-'));
  writeTree(clientDir, {
    'index.html': '<!doctype html><div id="root">hub</div>',
    'assets/app-abc.js': 'hub()',
  });
  standaloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-web-standalone-'));
  writeTree(standaloneDir, {
    'index.html': '<!doctype html><div id="root">standalone</div>',
    'assets/app-def.js': 'standalone()',
    'manifest.webmanifest': '{}',
  });
});

afterAll(() => {
  fs.rmSync(clientDir, { recursive: true, force: true });
  fs.rmSync(standaloneDir, { recursive: true, force: true });
});

afterEach(async () => {
  await host?.close();
  await upstream?.close();
  host = null;
  upstream = null;
});

/** A stand-in API on a free loopback port; returns that port. */
async function startUpstream(): Promise<number> {
  upstream = Fastify({ bodyLimit: 64 * 1024 * 1024 });
  upstream.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
  upstream.get('/api/echo', async (request) => ({
    url: request.url,
    xff: request.headers['x-forwarded-for'] ?? null,
    host: request.headers.host,
    proto: request.headers['x-forwarded-proto'] ?? null,
  }));
  upstream.post('/api/count', async (request) => {
    let bytes = 0;
    for await (const chunk of request.body as AsyncIterable<Buffer>) bytes += chunk.length;
    return { bytes };
  });
  upstream.post('/api/sink', async (request) => {
    let bytes = 0;
    try {
      for await (const chunk of request.body as AsyncIterable<Buffer>) bytes += chunk.length;
    } catch {
      uploadCutAt = Date.now();
    }
    return { bytes };
  });
  // Answers before reading the body, as a route whose query fails validation does.
  upstream.post('/api/refuse-early', (_request, reply) => {
    void reply.code(400).send({ error: 'BAD_REQUEST', message: 'refused before the body' });
  });
  upstream.get('/api/files/:name', async (request) => ({
    name: (request.params as { name: string }).name,
  }));
  upstream.get('/api/events', (_request, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
    reply.raw.write('data: first\n\n');
  });
  for (const root of PROXIED_ROOTS.filter((root) => root !== '/api')) {
    upstream.get(`${root}/*`, async (request) => ({ upstreamSaw: request.url }));
    upstream.get(root, async (request) => ({ upstreamSaw: request.url }));
  }
  await upstream.listen({ port: 0, host: '127.0.0.1' });
  const address = upstream.server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function hub(port: number): Promise<FastifyInstance> {
  host = await buildWebHost({
    kind: 'hub',
    clientDir,
    upstream: { host: '127.0.0.1', port },
    logger: silent,
  });
  return host;
}

/** A port nothing listens on: bind, read, close. */
async function deadPort(): Promise<number> {
  const probe = Fastify();
  await probe.listen({ port: 0, host: '127.0.0.1' });
  const address = probe.server.address();
  await probe.close();
  return typeof address === 'object' && address ? address.port : 0;
}

describe('hub mode', () => {
  it('forwards every API root to the API, unchanged', async () => {
    const web = await hub(await startUpstream());
    for (const url of [
      '/runestone/api/x',
      '/edda/api/x',
      '/groot/api/x',
      '/atlas/api/x',
      '/go/router',
      '/metrics',
    ]) {
      const response = await web.inject({ url });
      expect(response.json(), url).toEqual({ upstreamSaw: url });
    }
  });

  it('overwrites X-Forwarded-For with the real peer, and keeps the Host people opened', async () => {
    const web = await hub(await startUpstream());
    const response = await web.inject({
      url: '/api/echo',
      remoteAddress: '192.168.1.23',
      headers: { host: 'bifrost.local:4646', 'x-forwarded-for': '6.6.6.6' },
    });
    expect(response.json()).toMatchObject({
      xff: '192.168.1.23',
      host: 'bifrost.local:4646',
      proto: 'http',
    });
  });

  it('has no body limit of its own: the API decides', async () => {
    const web = await hub(await startUpstream());
    const body = Buffer.alloc(5 * 1024 * 1024, 1);
    const response = await web.inject({
      method: 'POST',
      url: '/api/count',
      headers: { 'content-type': 'application/octet-stream' },
      payload: body,
    });
    expect(response.json()).toEqual({ bytes: body.length });
  });

  it("delivers the API's early answer to an upload it refused before reading the body", async () => {
    const web = await hub(await startUpstream());
    await web.listen({ port: 0, host: '127.0.0.1' });
    const address = web.server.address();
    const webPort = typeof address === 'object' && address ? address.port : 0;
    for (const size of [64 * 1024, 8 * 1024 * 1024]) {
      const response = await fetch(`http://127.0.0.1:${webPort}/api/refuse-early?folder=x`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: Buffer.alloc(size, 1),
      });
      expect(response.status, `${size} bytes`).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' });
    }
  });

  it('keeps the connection when the API answers an upload before it has all arrived', async () => {
    // The API refuses some uploads before reading them (a bad query, a size
    // cap). Directly, Node then discards the rest of the body and keeps the
    // connection; closing it under a client still sending resets the socket,
    // and the client can lose the answer (seen once in 2,000 under load).
    const web = await hub(await startUpstream());
    await web.listen({ port: 0, host: '127.0.0.1' });
    const address = web.server.address();
    const webPort = typeof address === 'object' && address ? address.port : 0;
    const socket = net.connect({ port: webPort, host: '127.0.0.1' });
    await new Promise((resolve) => socket.once('connect', resolve));
    let received = '';
    socket.on('data', (chunk: Buffer) => (received += chunk.toString('latin1')));
    const half = Buffer.alloc(100_000, 1);
    socket.write(
      'POST /api/refuse-early HTTP/1.1\r\nHost: x\r\n' +
        'Content-Type: application/octet-stream\r\nContent-Length: 200000\r\n\r\n',
    );
    socket.write(half);
    await expect.poll(() => received, { timeout: 5_000 }).toContain('refused before the body');
    expect(received).toMatch(/^HTTP\/1\.1 400/);
    expect(received.toLowerCase()).not.toContain('connection: close');

    // The rest of the body, then a second request on the same connection.
    received = '';
    socket.write(half);
    socket.write('GET /healthz HTTP/1.1\r\nHost: x\r\n\r\n');
    await expect.poll(() => received, { timeout: 5_000 }).toContain('"ok":true');
    expect(received).toMatch(/^HTTP\/1\.1 200/);
    socket.destroy();
  });

  it('still tells the API at once when a client abandons an upload', async () => {
    uploadCutAt = null;
    const web = await hub(await startUpstream());
    await web.listen({ port: 0, host: '127.0.0.1' });
    const address = web.server.address();
    const webPort = typeof address === 'object' && address ? address.port : 0;
    const socket = net.connect({ port: webPort, host: '127.0.0.1' });
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(
      'POST /api/sink HTTP/1.1\r\nHost: x\r\n' +
        'Content-Type: application/octet-stream\r\nContent-Length: 10000000\r\n\r\n',
    );
    socket.write(Buffer.alloc(1_000_000, 1));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const abandonedAt = Date.now();
    socket.destroy();
    await expect.poll(() => uploadCutAt, { timeout: 5_000 }).not.toBeNull();
    expect(uploadCutAt! - abandonedAt).toBeLessThan(1_000);
  });

  it('forwards the query string untouched, dot segments and all', async () => {
    const web = await hub(await startUpstream());
    const url = '/api/echo?q=..%2Fnotes&q=a+b&flag&path=../x';
    expect((await web.inject({ url })).json()).toMatchObject({ url });
  });

  it("refuses a dotted path in the API's error shape, as the API would have", async () => {
    const web = await hub(await startUpstream());
    for (const url of ['/api/files/..%2Fescape', '/api/files/..hidden', '/go/..%2Fx']) {
      const response = await web.inject({ url });
      expect(response.statusCode, url).toBe(400);
      expect(response.json(), url).toMatchObject({ error: 'BAD_REQUEST' });
    }
  });

  it('passes an SSE stream through as it is written', async () => {
    const port = await startUpstream();
    const web = await hub(port);
    await web.listen({ port: 0, host: '127.0.0.1' });
    const address = web.server.address();
    const webPort = typeof address === 'object' && address ? address.port : 0;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${webPort}/api/events`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('data: first');
    controller.abort();
  });

  it('ends an open event stream cleanly when it shuts down, rather than cutting it mid-chunk', async () => {
    const web = await hub(await startUpstream());
    await web.listen({ port: 0, host: '127.0.0.1' });
    const address = web.server.address();
    const webPort = typeof address === 'object' && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${webPort}/api/events`);
    const reader = response.body!.getReader();
    await reader.read();
    const closing = web.close();
    host = null;
    // A cut stream rejects the read ("terminated"); a clean end reports done.
    let result = await reader.read();
    while (!result.done) result = await reader.read();
    expect(result.done).toBe(true);
    await closing;
  });

  it('serves the hub client, with the SPA fallback for client routes', async () => {
    const web = await hub(await startUpstream());
    expect((await web.inject({ url: '/' })).body).toContain('hub');
    expect((await web.inject({ url: '/runestone/some-slug' })).body).toContain('hub');
    expect((await web.inject({ url: '/assets/app-abc.js' })).body).toBe('hub()');
    const post = await web.inject({ method: 'POST', url: '/not-a-route' });
    expect(post.statusCode).toBe(404);
  });

  it('answers its own health without the API', async () => {
    const web = await hub(await deadPort());
    const response = await web.inject({ url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, mode: 'hub' });
  });

  it('answers 502 HUB_UNAVAILABLE while the API is down, and still serves the client', async () => {
    const web = await hub(await deadPort());
    const api = await web.inject({ url: '/api/health' });
    expect(api.statusCode).toBe(502);
    expect(api.json()).toMatchObject({ error: 'HUB_UNAVAILABLE' });
    expect((await web.inject({ url: '/' })).body).toContain('hub');
  });

  it('answers a /go link with an HTML closed page while the API is down, not raw JSON', async () => {
    const web = await hub(await deadPort());
    const response = await web.inject({ url: '/go/router' });
    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['retry-after']).toBe('5');
    expect(response.body).toContain('The Bifröst is closed');
  });
});

describe('standalone mode (BIFROST_RUN=web)', () => {
  async function standalone(): Promise<FastifyInstance> {
    host = await buildWebHost({ kind: 'standalone', clientDir: standaloneDir, logger: silent });
    return host;
  }

  it('forwards nothing: hub paths land on the app, which shows the sheet', async () => {
    const web = await standalone();
    for (const url of ['/api/health', '/go/router', '/edda/api/raw/x', '/hermes']) {
      const response = await web.inject({ url });
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).toContain('standalone');
      expect(response.headers['cache-control'], url).toBe('no-cache');
    }
  });

  it('caches hashed assets forever, 404s a missing one, and sends the security headers', async () => {
    const web = await standalone();
    const asset = await web.inject({ url: '/assets/app-def.js' });
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
    expect(asset.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect((await web.inject({ url: '/assets/gone-000.js' })).statusCode).toBe(404);
  });

  it('types the web manifest, and refuses anything but GET and HEAD', async () => {
    const web = await standalone();
    expect((await web.inject({ url: '/manifest.webmanifest' })).headers['content-type']).toContain(
      'application/manifest+json',
    );
    expect((await web.inject({ method: 'POST', url: '/api/runestone' })).statusCode).toBe(405);
  });
});
