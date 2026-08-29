import { describe, expect, it, vi } from 'vitest';
import { CHUNK_TIMEOUT_MS, isChunkLoadError, withChunkTimeout } from './chunkError';

describe('isChunkLoadError', () => {
  it('recognises the rejection each engine words differently', () => {
    const messages = [
      'Failed to fetch dynamically imported module: http://bifrost.local:4646/assets/LokiPage-5qLONRRM.js',
      'error loading dynamically imported module: http://bifrost.local:4646/assets/EddaPage-x.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/GrootPage-y.css',
      'Timed out fetching dynamically imported module',
    ];
    for (const message of messages) {
      expect(isChunkLoadError(new Error(message))).toBe(true);
    }
  });

  it('leaves a real render bug to the app-wide crash card', () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(
      false,
    );
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false);
  });

  it('survives a thrown non-Error', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module: /a.js')).toBe(true);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('withChunkTimeout', () => {
  it('passes a chunk that arrives straight through', async () => {
    await expect(withChunkTimeout(Promise.resolve('module'), 50)).resolves.toBe('module');
  });

  it('keeps the original failure when the fetch fails on its own', async () => {
    const refused = new Error('Failed to fetch dynamically imported module: /a.js');
    await expect(withChunkTimeout(Promise.reject(refused), 50)).rejects.toBe(refused);
  });

  it('gives up on a hung fetch, with a message the boundary recognises', async () => {
    vi.useFakeTimers();
    try {
      const hung = withChunkTimeout(new Promise(() => {}), 8_000);
      const settled = expect(hung).rejects.toSatisfy(isChunkLoadError);
      await vi.advanceTimersByTimeAsync(8_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits long enough for a real LAN load, short enough to beat the browser', () => {
    expect(CHUNK_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(CHUNK_TIMEOUT_MS).toBeLessThan(30_000);
  });
});
