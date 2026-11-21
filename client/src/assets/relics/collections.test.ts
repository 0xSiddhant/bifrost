import { describe, expect, it } from 'vitest';
import { ALL_COLLECTIONS } from './collections';
import { RELIC_COLLECTIONS } from '.';

// PLAN-41: the names load with the shell and the drawings after it, so the
// two lists live in different modules and must not drift apart.
describe('relic collections', () => {
  it('names exactly the collections that have drawings, in the same order', () => {
    expect([...ALL_COLLECTIONS]).toEqual(Object.keys(RELIC_COLLECTIONS));
  });

  it('gives every collection a label and at least one drawing', () => {
    for (const name of ALL_COLLECTIONS) {
      expect(RELIC_COLLECTIONS[name].label).not.toBe('');
      expect(RELIC_COLLECTIONS[name].relics.length).toBeGreaterThan(0);
    }
  });
});
