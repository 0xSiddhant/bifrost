import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './chunkError';

describe('isChunkLoadError', () => {
  it('recognises the rejection each engine words differently', () => {
    const messages = [
      'Failed to fetch dynamically imported module: http://bifrost.local:4646/assets/LokiPage-5qLONRRM.js',
      'error loading dynamically imported module: http://bifrost.local:4646/assets/EddaPage-x.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/GrootPage-y.css',
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
