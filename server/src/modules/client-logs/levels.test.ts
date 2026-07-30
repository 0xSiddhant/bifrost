import { describe, expect, it } from 'vitest';
import { atOrAboveFloor } from './levels.js';

describe('atOrAboveFloor', () => {
  it('accepts the floor itself and everything more severe', () => {
    expect(atOrAboveFloor('warn', 'warn')).toBe(true);
    expect(atOrAboveFloor('error', 'warn')).toBe(true);
    expect(atOrAboveFloor('fatal', 'warn')).toBe(true);
  });

  it('rejects anything below the floor', () => {
    expect(atOrAboveFloor('info', 'warn')).toBe(false);
    expect(atOrAboveFloor('debug', 'warn')).toBe(false);
    expect(atOrAboveFloor('trace', 'warn')).toBe(false);
  });

  it('lets a lowered floor open the gate without a client rebuild', () => {
    expect(atOrAboveFloor('debug', 'debug')).toBe(true);
    expect(atOrAboveFloor('trace', 'trace')).toBe(true);
  });
});
