/**
 * Test-payload arithmetic, kept pure so the interesting parts (cycling, caps)
 * are unit-testable without a socket. The bytes themselves come from
 * `services/payload-pool.ts`.
 */

/** One write per 64 KiB: large enough that syscall overhead doesn't shape the measurement. */
export const CHUNK_BYTES = 64 * 1024;

/**
 * Size of the pre-generated random pool the download stream cycles. Generated
 * once at boot and reused forever: reading `/dev/urandom` per request would
 * measure the CSPRNG, not the network, and a buffer of zeros would let any
 * compressor on the path invent throughput out of nothing.
 */
export const POOL_BYTES = 4 * 1024 * 1024;

const MB = 1024 * 1024;

export const bytesForMb = (mb: number): number => mb * MB;

/** Mb of a byte count, for reporting. */
export const mbOfBytes = (bytes: number): number => bytes / MB;

/**
 * Resolves a requested test size against the configured ceiling. Returns null
 * for anything that isn't a usable positive size, so the route can 400 rather
 * than silently stream a default the client didn't ask for.
 */
export function resolveTestMb(requested: unknown, maxMb: number): number | null {
  const mb = typeof requested === 'number' ? requested : Number(requested);
  if (!Number.isFinite(mb) || mb <= 0) return null;
  return Math.min(Math.floor(mb), maxMb);
}

/**
 * The three sizes the page offers. The ceiling is always the last option, so a
 * lowered `NIMBUS_MAX_TEST_MB` shrinks the menu instead of offering a size that
 * would be clamped behind the user's back.
 */
export function testSizes(maxMb: number): number[] {
  return [...new Set([10, 50, maxMb].filter((mb) => mb <= maxMb))].sort((a, b) => a - b);
}

/**
 * Copies `length` bytes out of `pool` starting at `offset`, wrapping around the
 * end as many times as needed. Wrapping is what lets a 4 MiB pool serve a
 * 100 MB test at flat memory; the returned buffer is a view when the window
 * doesn't wrap, so the common case copies nothing.
 */
export function chunkFrom(pool: Buffer, offset: number, length: number): Buffer {
  if (pool.length === 0) throw new Error('payload pool is empty');
  const start = ((offset % pool.length) + pool.length) % pool.length;
  if (start + length <= pool.length) return pool.subarray(start, start + length);

  const out = Buffer.allocUnsafe(length);
  let written = 0;
  let cursor = start;
  while (written < length) {
    const take = Math.min(pool.length - cursor, length - written);
    pool.copy(out, written, cursor, cursor + take);
    written += take;
    cursor = (cursor + take) % pool.length;
  }
  return out;
}
