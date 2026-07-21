import { describe, expect, it } from 'vitest';
import { CHARACTER_NAMES, pickCharacterName } from './character-names.js';

describe('character names', () => {
  it('is a deduplicated pool spanning the four universes', () => {
    expect(CHARACTER_NAMES.length).toBeGreaterThan(60);
    expect(new Set(CHARACTER_NAMES).size).toBe(CHARACTER_NAMES.length);
    expect(CHARACTER_NAMES).toContain('Thor'); // norse
    expect(CHARACTER_NAMES).toContain('Hermione'); // potter
    expect(CHARACTER_NAMES).toContain('Iron Man'); // mcu
    expect(CHARACTER_NAMES).toContain('Zeus'); // greek
  });

  it('never returns a name already in use', () => {
    const used = new Set(CHARACTER_NAMES.slice(0, 5));
    for (let i = 0; i < 30; i += 1) {
      expect(used.has(pickCharacterName(used))).toBe(false);
    }
  });

  it('falls back to a numbered Traveler when the pool is exhausted', () => {
    expect(pickCharacterName(new Set(CHARACTER_NAMES))).toMatch(/^Traveler \d+$/);
  });

  it('is deterministic under a seeded rng', () => {
    expect(pickCharacterName(new Set(), () => 0)).toBe(CHARACTER_NAMES[0]);
  });
});
