import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BROTLI_QUALITY, BrotliDecodeError, BrotliLimitError } from '../ports.js';
import { NodeBrotliCodec } from './node-brotli-codec.js';

const codec = new NodeBrotliCodec();

/** Collects a stream, or the error it died of, plus what it managed to emit. */
async function drain(stream: Readable): Promise<{ bytes: Buffer; error: unknown }> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return { bytes: Buffer.concat(chunks), error: null };
  } catch (error) {
    return { bytes: Buffer.concat(chunks), error };
  }
}

async function collect(stream: Readable): Promise<Buffer> {
  const { bytes, error } = await drain(stream);
  if (error) throw error;
  return bytes;
}

/**
 * WBITS out of a Brotli stream header (RFC 7932 §9.1), read LSB-first.
 * The standard window tops out at 24; the large-window extension this module
 * deliberately never enables is what would push it past that.
 */
function windowBitsOf(compressed: Buffer): number {
  const bitAt = (index: number): number => ((compressed[index >> 3] ?? 0) >> (index % 8)) & 1;
  if (bitAt(0) === 0) return 16;
  const high = bitAt(1) | (bitAt(2) << 1) | (bitAt(3) << 2);
  if (high !== 0) return 17 + high;
  const low = bitAt(4) | (bitAt(5) << 1) | (bitAt(6) << 2);
  return low === 0 ? 17 : 8 + low;
}

describe('NodeBrotliCodec', () => {
  const sample = Buffer.from('the quick brown fox jumps over the lazy dog\n'.repeat(500));

  it('produces output the reference decoder reads back byte for byte', async () => {
    const compressed = await collect(codec.compress(Readable.from(sample), 9, 1_000_000));
    // zlib's own sync API is the oracle: if it disagrees, "universally
    // decodable" was never true in the first place.
    expect(zlib.brotliDecompressSync(compressed)).toEqual(sample);
    expect(compressed.length).toBeLessThan(sample.length);
  });

  it('reads back what the reference encoder produced', async () => {
    const compressed = zlib.brotliCompressSync(sample);
    const restored = await collect(codec.decompress(Readable.from(compressed), 1_000_000));
    expect(restored).toEqual(sample);
  });

  it('compresses at every offered quality, all three round-tripping', async () => {
    const sizes: number[] = [];
    for (const quality of Object.values(BROTLI_QUALITY)) {
      const compressed = await collect(codec.compress(Readable.from(sample), quality, 1_000_000));
      expect(zlib.brotliDecompressSync(compressed)).toEqual(sample);
      sizes.push(compressed.length);
    }
    // Higher quality should not cost bytes; equality is allowed because a small
    // fixture can genuinely bottom out before quality 11 has anything left.
    expect(sizes[0]).toBeGreaterThanOrEqual(sizes[2] ?? 0);
  });

  it('never enables the large-window extension', async () => {
    const compressed = await collect(codec.compress(Readable.from(sample), 11, 1_000_000));
    expect(windowBitsOf(compressed)).toBeLessThanOrEqual(24);
    // The property that actually matters for the page's own footer claim: a
    // decoder that refuses large-window streams still reads this one.
    expect(() => zlib.brotliDecompressSync(compressed)).not.toThrow();
  });

  it('aborts a compress whose input passes the cap', async () => {
    const { error } = await drain(codec.compress(Readable.from(sample), 9, 100));
    expect(error).toBeInstanceOf(BrotliLimitError);
  });

  it('aborts a decompression bomb without producing more than the cap allows', async () => {
    // 32 MB of zeros is a few hundred bytes compressed — the exact shape the
    // guard exists for: the input size says nothing about the output size.
    const bomb = zlib.brotliCompressSync(Buffer.alloc(32 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(64 * 1024);

    const cap = 256 * 1024;
    const { bytes, error } = await drain(codec.decompress(Readable.from(bomb), cap));
    expect(error).toBeInstanceOf(BrotliLimitError);
    // Bounded by construction: the counter destroys the pipeline instead of
    // passing the chunk that would cross the cap.
    expect(bytes.length).toBeLessThanOrEqual(cap);
  });

  it('tears the source down when the consumer walks away mid-stream', async () => {
    // A client that vanishes mid-request: nothing will read this again, and the
    // zlib stream behind it must not be left running for no reader.
    const source = new Readable({
      read() {
        this.push(Buffer.alloc(64 * 1024));
      },
    });
    const output = codec.compress(source, 9, 64 * 1024 * 1024);
    await output[Symbol.asyncIterator]().next();
    output.destroy();
    // Waited for rather than assumed after a fixed delay: the teardown travels
    // back through the generator's return and zlib's own close, which takes
    // more than a tick, so a snapshot straight after `destroy()` reads false
    // while the cleanup is still perfectly real. (`events.once` is no good
    // here — it rejects on the abort the teardown carries with it.)
    await new Promise<void>((resolve) => source.once('close', resolve));

    expect(source.destroyed).toBe(true);
  });

  it('reports bytes that are not brotli as a decode failure', async () => {
    const { error } = await drain(codec.decompress(Readable.from(Buffer.from('not brotli')), 1e6));
    expect(error).toBeInstanceOf(BrotliDecodeError);
  });

  it('reports a truncated brotli stream as a decode failure', async () => {
    const compressed = zlib.brotliCompressSync(sample);
    const truncated = compressed.subarray(0, compressed.length - 8);
    const { error } = await drain(codec.decompress(Readable.from(truncated), 1e6));
    expect(error).toBeInstanceOf(BrotliDecodeError);
  });
});
