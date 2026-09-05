import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type RunningApp } from '../../app.js';
import { loadConfig } from '../../core/config/index.js';

const MAX_INPUT_MB = 1;
const MAX_OUTPUT_MB = 4;
const MB = 1024 * 1024;

/**
 * Driven over a real socket rather than `fastify.inject`, on the same reasoning
 * `download-folders.int.test.ts` already listens for its zip stream: half of
 * what this module promises is about what happens to a *connection* once
 * headers are already out, and a mock request/response pair has no connection
 * to end. The cheap cases still go through the same client for one shape.
 */
describe('brotli module', () => {
  let app: RunningApp;
  let storageRoot: string;
  let origin: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-brotli-'));
    const config = loadConfig({
      HEIMDALL_PIN: '4321',
      STORAGE_ROOT: storageRoot,
      // Small caps keep the byte assertions fast; the arithmetic is identical
      // at the shipped 256/512 MB.
      BROTLI_MAX_INPUT_MB: String(MAX_INPUT_MB),
      BROTLI_MAX_OUTPUT_MB: String(MAX_OUTPUT_MB),
    });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
    await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    const address = app.fastify.server.address();
    origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  }, 30_000);

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const post = (url: string, body: BodyInit, init: RequestInit = {}) =>
    fetch(`${origin}${url}`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/octet-stream' },
      ...init,
    });

  const buffer = async (response: Response) => Buffer.from(await response.arrayBuffer());

  const sample = Buffer.from('brotli round trip fixture — ☃\n'.repeat(400));

  it('advertises the module in capabilities', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/api/capabilities' });
    expect(response.json().modules).toContain('brotli');
  });

  it('serves the configured caps so the page never hardcodes them', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/api/brotli/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      maxInputMb: MAX_INPUT_MB,
      maxOutputMb: MAX_OUTPUT_MB,
      qualities: ['fast', 'balanced', 'best'],
      defaultQuality: 'balanced',
    });
  });

  it('compresses and decompresses back to the original bytes', async () => {
    const compressed = await post('/api/brotli/compress', sample);
    expect(compressed.status).toBe(200);
    expect(compressed.headers.get('content-type')).toBe('application/octet-stream');
    // The client names its own downloads; the server never invents a filename.
    expect(compressed.headers.get('content-disposition')).toBeNull();
    const packed = await buffer(compressed);
    expect(packed.length).toBeLessThan(sample.length);

    const restored = await post('/api/brotli/decompress', packed);
    expect(restored.status).toBe(200);
    expect(await buffer(restored)).toEqual(sample);
  });

  it('interoperates with the reference codec in both directions', async () => {
    const ours = await post('/api/brotli/compress', sample);
    expect(zlib.brotliDecompressSync(await buffer(ours))).toEqual(sample);

    const theirs = await post('/api/brotli/decompress', zlib.brotliCompressSync(sample));
    expect(await buffer(theirs)).toEqual(sample);
  });

  it('honours each quality and rejects anything outside the three names', async () => {
    for (const quality of ['fast', 'balanced', 'best']) {
      const response = await post(`/api/brotli/compress?quality=${quality}`, sample);
      expect(response.status, quality).toBe(200);
      expect(zlib.brotliDecompressSync(await buffer(response)), quality).toEqual(sample);
    }
    const refused = await post('/api/brotli/compress?quality=11', sample);
    expect(refused.status).toBe(400);
  });

  it('refuses a declared-oversize compress before reading the body', async () => {
    const response = await post('/api/brotli/compress', Buffer.alloc(MAX_INPUT_MB * MB + 1024));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe('PAYLOAD_TOO_LARGE');
  });

  it('still catches an oversize compress that declares no length', async () => {
    // A streamed body is sent chunked, so there is no content-length for the
    // pre-check to read and the streaming counter is the only guard left.
    const chunked = Readable.toWeb(
      Readable.from([Buffer.alloc(MAX_INPUT_MB * MB + 1024)]),
    ) as ReadableStream;
    const response = await post('/api/brotli/compress', chunked, { duplex: 'half' } as RequestInit);
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers 422 for bytes that are not brotli at all', async () => {
    const response = await post('/api/brotli/decompress', Buffer.from('this is not a .br file'));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('INVALID_BROTLI');
  });

  it('aborts a decompression bomb at the cap instead of expanding it', async () => {
    // Tens of bytes in, 32 MB out — the exact shape no input-side check could
    // have caught, since a compressed size says nothing about its expansion.
    const bomb = zlib.brotliCompressSync(Buffer.alloc(32 * MB));
    expect(bomb.length).toBeLessThan(64 * 1024);

    const response = await post('/api/brotli/decompress', bomb);
    // The cap trips long after the first output chunk went out, so there is no
    // status left to change: the response ends mid-body instead. Memory stays
    // bounded either way, which is what the guard is actually for.
    expect(response.status).toBe(200);
    const { received, failed } = await readUntilItStops(response);
    expect(failed).toBe(true);
    expect(received).toBeLessThanOrEqual(MAX_OUTPUT_MB * MB);
  }, 30_000);

  it('survives a client that abandons a decompress midway', async () => {
    const bomb = zlib.brotliCompressSync(Buffer.alloc(32 * MB));
    const controller = new AbortController();
    const response = await post('/api/brotli/decompress', bomb, { signal: controller.signal });
    const reader = response.body?.getReader();
    await reader?.read();
    controller.abort();
    await reader?.cancel().catch(() => undefined);

    // The real assertion: nothing is wedged afterwards. A codec left running
    // for a reader that has gone would show up here, since the next request
    // shares the same process.
    const after = await post('/api/brotli/compress', sample);
    expect(after.status).toBe(200);
    expect(zlib.brotliDecompressSync(await buffer(after))).toEqual(sample);
  }, 30_000);

  it('ends the response mid-stream when a valid .br turns out to be truncated', async () => {
    // Varied bytes, not one repeated byte: a uniform buffer compresses into a
    // single meta-block the decoder emits nothing from until it is whole, which
    // would quietly re-test the clean 422 above instead of this path.
    const varied = Buffer.alloc(2 * MB);
    let seed = 1;
    for (let index = 0; index < varied.length; index += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      varied[index] = 32 + (seed % 90);
    }
    const compressed = zlib.brotliCompressSync(varied);
    const response = await post('/api/brotli/decompress', compressed.subarray(0, -64));

    expect(response.status).toBe(200);
    const { received, failed } = await readUntilItStops(response);
    expect(failed).toBe(true);
    expect(received).toBeGreaterThan(0);
    expect(received).toBeLessThan(varied.length);
  });
});

/**
 * The cloud profile runs the same module with the same caps — the point of
 * putting it in both manifests rather than gating it to local. Driven through
 * `inject`, which is enough here: nothing in this block is about what happens
 * to a connection after headers are out.
 */
describe('brotli module on the cloud profile', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-brotli-cloud-'));
    app = await createApp(
      loadConfig({
        HEIMDALL_PIN: '4321',
        STORAGE_ROOT: storageRoot,
        DEPLOY_PROFILE: 'cloud',
        BROTLI_MAX_INPUT_MB: String(MAX_INPUT_MB),
      }),
      { logger: pino({ level: 'silent' }) },
    );
  }, 30_000);

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const send = (url: string, payload: Buffer) =>
    app.fastify.inject({
      method: 'POST',
      url,
      payload,
      headers: { 'content-type': 'application/octet-stream' },
    });

  it('round-trips and enforces the same input cap', async () => {
    const source = Buffer.from('cloud profile fixture\n'.repeat(200));
    const compressed = await send('/api/brotli/compress', source);
    expect(compressed.statusCode).toBe(200);

    const restored = await send('/api/brotli/decompress', compressed.rawPayload);
    expect(restored.rawPayload).toEqual(source);

    const oversize = await send('/api/brotli/compress', Buffer.alloc(MAX_INPUT_MB * MB + 1024));
    expect(oversize.statusCode).toBe(413);
  });
});

/** Reads a body that is expected to be cut off, reporting how far it got. */
async function readUntilItStops(response: Response): Promise<{
  received: number;
  failed: boolean;
}> {
  let received = 0;
  try {
    const reader = response.body?.getReader();
    if (!reader) return { received, failed: false };
    for (;;) {
      const step = await reader.read();
      if (step.done) return { received, failed: false };
      received += step.value.length;
    }
  } catch {
    // The whole point of the assertion: the connection ended without a trailer,
    // which fetch reports as a read failure rather than a status.
    return { received, failed: true };
  }
}
