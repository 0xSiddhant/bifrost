import { describe, expect, it } from 'vitest';
import { bytesForMb, chunkFrom, resolveTestMb, testSizes } from './payload.js';
import { createPayloadPool, createPayloadStream } from './services/payload-pool.js';

describe('nimbus payload arithmetic', () => {
  it('resolves and clamps a requested test size', () => {
    expect(resolveTestMb(10, 100)).toBe(10);
    expect(resolveTestMb('50', 100)).toBe(50);
    // Past the configured ceiling the request is clamped, never refused.
    expect(resolveTestMb(500, 100)).toBe(100);
    expect(resolveTestMb(10.9, 100)).toBe(10);
  });

  it('rejects sizes that are not usable', () => {
    for (const bad of [0, -5, 'abc', null, undefined, Number.NaN, Infinity]) {
      expect(resolveTestMb(bad, 100)).toBeNull();
    }
  });

  it('offers 10/50/max and drops options above a lowered ceiling', () => {
    expect(testSizes(100)).toEqual([10, 50, 100]);
    expect(testSizes(50)).toEqual([10, 50]);
    expect(testSizes(25)).toEqual([10, 25]);
    // The ceiling is never duplicated when it coincides with a fixed option.
    expect(testSizes(10)).toEqual([10]);
  });

  it('converts MB to bytes in binary megabytes', () => {
    expect(bytesForMb(1)).toBe(1024 * 1024);
    expect(bytesForMb(100)).toBe(104_857_600);
  });
});

describe('chunkFrom (pool cycling)', () => {
  const pool = Buffer.from('0123456789');

  it('returns a view when the window does not wrap', () => {
    expect(chunkFrom(pool, 0, 4).toString()).toBe('0123');
    expect(chunkFrom(pool, 6, 4).toString()).toBe('6789');
  });

  it('wraps around the end of the pool', () => {
    expect(chunkFrom(pool, 8, 4).toString()).toBe('8901');
  });

  it('wraps repeatedly for a request larger than the pool', () => {
    expect(chunkFrom(pool, 0, 25).toString()).toBe('0123456789012345678901234');
  });

  it('treats the offset as a position in an endless cycle', () => {
    // Offset 13 is offset 3 on the second lap — this is what lets the download
    // stream track a byte counter instead of a pool index.
    expect(chunkFrom(pool, 13, 3).toString()).toBe(chunkFrom(pool, 3, 3).toString());
  });
});

describe('payload stream', () => {
  it('emits exactly the requested byte count, in bounded chunks', async () => {
    const pool = createPayloadPool(64 * 1024);
    const total = 200 * 1024 + 7;
    const stream = createPayloadStream(pool, total, 16 * 1024);

    let received = 0;
    let biggest = 0;
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      received += buffer.length;
      biggest = Math.max(biggest, buffer.length);
    }

    expect(received).toBe(total);
    // Nothing bigger than one chunk is ever resident — the whole payload is
    // never assembled in memory.
    expect(biggest).toBeLessThanOrEqual(16 * 1024);
  });

  it('generates data that does not compress (no faked throughput)', async () => {
    const { gzipSync } = await import('node:zlib');
    const pool = createPayloadPool(1024 * 1024);
    const chunks: Buffer[] = [];
    for await (const chunk of createPayloadStream(pool, 2 * 1024 * 1024)) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);
    // Zeros would gzip to ~nothing and a compressing proxy would report an
    // imaginary Mbps; random bytes cannot be shrunk.
    expect(gzipSync(body).length).toBeGreaterThan(body.length * 0.95);
  });
});
