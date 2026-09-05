// @vitest-environment jsdom
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipBytes, hasCompressionStream } from './compressionSupport';

describe('compressionSupport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the API as present when the browser has it', () => {
    expect(hasCompressionStream()).toBe(true);
  });

  it('reports it as absent where it is not, so the panel can hide rather than break', () => {
    vi.stubGlobal('CompressionStream', undefined);
    expect(hasCompressionStream()).toBe(false);
  });

  it('gzips bytes to something the reference decoder reads back', async () => {
    const source = new TextEncoder().encode('a gzip fixture worth repeating\n'.repeat(200));
    const { size, blob } = await gzipBytes(source);

    expect(size).toBe(blob.size);
    expect(size).toBeLessThan(source.length);
    // The blob is kept, not discarded, so "Download .gz" is free — and this is
    // what proves the bytes in it are a real gzip stream, not just a size.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(gunzipSync(bytes)).toEqual(Buffer.from(source));
  });
});
