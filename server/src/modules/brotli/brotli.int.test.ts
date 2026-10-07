import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningApp } from '../../app.js';
import { createTestApp } from '../../testing/app.js';

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
    app = await createTestApp({
      STORAGE_ROOT: storageRoot,
      // Small caps keep the byte assertions fast; the arithmetic is identical
      // at the shipped 256/512 MB.
      BROTLI_MAX_INPUT_MB: String(MAX_INPUT_MB),
      BROTLI_MAX_OUTPUT_MB: String(MAX_OUTPUT_MB),
    });
    await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    const address = app.fastify.server.address();
    origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  }, 30_000);

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  // `RequestInit['body']`, not the DOM's `BodyInit`: this workspace's lib is
  // ES2022 + node, so the only fetch types available are the ones @types/node
  // itself exports.
  const post = (url: string, body: RequestInit['body'], init: RequestInit = {}) =>
    fetch(`${origin}${url}`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/octet-stream' },
      ...init,
    });

  const buffer = async (response: Response) => Buffer.from(await response.arrayBuffer());
  const errorCode = async (response: Response) =>
    ((await response.json()) as { error?: string }).error;

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
    expect(await errorCode(response)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('still catches an oversize compress that declares no length', async () => {
    // A streamed body is sent chunked, so there is no content-length for the
    // pre-check to read and the streaming counter is the only guard left.
    const chunked = Readable.toWeb(Readable.from([Buffer.alloc(MAX_INPUT_MB * MB + 1024)]));
    const response = await post(
      '/api/brotli/compress',
      chunked as RequestInit['body'],
      {
        duplex: 'half',
      } as RequestInit,
    );
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers 422 for bytes that are not brotli at all', async () => {
    const response = await post('/api/brotli/decompress', Buffer.from('this is not a .br file'));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('INVALID_BROTLI');
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

  it.each([
    // The counterexample PLAN-33's fuzzer shrank to: one byte decodes, then EOF.
    ['four bytes that decode one byte, then end', Buffer.from([0, 0, 16, 0])],
    [
      'a small .br cut short',
      zlib.brotliCompressSync(Buffer.from('the bridge holds; '.repeat(400))).subarray(0, -8),
    ],
  ])('answers 422 for %s, instead of a 200 cut off mid-body', async (_label, input) => {
    // The output fits in the held head (1 MiB), so the decode fails before
    // any status is committed and the refusal can still be honest.
    const response = await post('/api/brotli/decompress', input);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'INVALID_BROTLI' });
  });

  it('ends the response mid-stream when a valid .br turns out to be truncated', async () => {
    // Random letters from a four-symbol alphabet: 2 bits each, so 3 MiB
    // compresses to ~0.75 MB (under the 1 MB input cap) and the decoder emits
    // output as it goes. A uniform or short-cycle buffer compresses to almost
    // nothing and fails before emitting much, which would quietly re-test the
    // clean 422 above. Well past the 1 MiB the route holds before committing a
    // status, so this failure lands after headers are out.
    const varied = Buffer.from(
      crypto.randomBytes(3 * MB).map((byte) => 'acgt'.charCodeAt(byte & 3)),
    );
    // Quality 5: a fixture only needs to be valid Brotli, and 11 takes seconds.
    const compressed = zlib.brotliCompressSync(varied, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    });
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
    app = await createTestApp({
      STORAGE_ROOT: storageRoot,
      DEPLOY_PROFILE: 'cloud',
      BROTLI_MAX_INPUT_MB: String(MAX_INPUT_MB),
    });
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
