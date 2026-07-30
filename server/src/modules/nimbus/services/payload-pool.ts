import { randomFillSync } from 'node:crypto';
import { Readable } from 'node:stream';
import { CHUNK_BYTES, chunkFrom, POOL_BYTES } from '../payload.js';

/**
 * The one random pool the download stream cycles for the life of the process.
 * Filled once at module registration: generating entropy per request would put
 * the CSPRNG in the measurement, and a pool of zeros would be compressible —
 * either way the number on screen would stop being a network number.
 */
export function createPayloadPool(bytes: number = POOL_BYTES): Buffer {
  const pool = Buffer.allocUnsafe(bytes);
  // randomFillSync caps at 65536 bytes per call.
  for (let offset = 0; offset < bytes; offset += 65536) {
    randomFillSync(pool, offset, Math.min(65536, bytes - offset));
  }
  return pool;
}

/**
 * A readable of exactly `totalBytes` bytes, sliced out of the pool.
 *
 * `_read` produces one chunk per pull, so the stream only generates what the
 * socket is ready to take — the whole payload is never resident, and a phone
 * that can't keep up slows the sender instead of filling memory. That
 * backpressure is also what makes the client's chunk-arrival timings mean
 * something: the bytes leave as fast as the network accepts them, no faster.
 */
export function createPayloadStream(
  pool: Buffer,
  totalBytes: number,
  chunkBytes: number = CHUNK_BYTES,
): Readable {
  let sent = 0;
  return new Readable({
    read() {
      if (sent >= totalBytes) {
        this.push(null);
        return;
      }
      const length = Math.min(chunkBytes, totalBytes - sent);
      const chunk = chunkFrom(pool, sent, length);
      sent += length;
      this.push(chunk);
    },
  });
}
