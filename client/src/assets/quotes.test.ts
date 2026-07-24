import { describe, expect, it } from 'vitest';
import { pickRandomQuote, QUOTES, WORLD_LABELS } from './quotes';

describe('quotes bank', () => {
  it('is non-empty and every quote has text, author, and a labelled world', () => {
    expect(QUOTES.length).toBeGreaterThan(0);
    for (const q of QUOTES) {
      expect(q.text.trim().length).toBeGreaterThan(0);
      expect(q.author.trim().length).toBeGreaterThan(0);
      expect(WORLD_LABELS[q.world]).toBeTruthy();
    }
  });

  it('covers all five worlds', () => {
    const worlds = new Set(QUOTES.map((q) => q.world));
    expect(worlds).toEqual(new Set(Object.keys(WORLD_LABELS)));
  });

  it('picks deterministically for a fixed rng and always returns from the pool', () => {
    expect(pickRandomQuote(QUOTES, () => 0)).toBe(QUOTES[0]);
    const last = pickRandomQuote(QUOTES, () => 0.999999);
    expect(QUOTES).toContain(last);
  });

  it('falls back to the built-in bank for an empty pool', () => {
    expect(QUOTES).toContain(pickRandomQuote([], () => 0.5));
  });
});
