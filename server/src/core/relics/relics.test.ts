import { describe, expect, it } from 'vitest';
import {
  RELIC_ADJECTIVES,
  RELIC_BANK,
  relicTitle,
  uniqueRelicTitle,
  type RelicCategory,
} from './index.js';

/** Deterministic rng from a fixed sequence (cycled). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i += 1;
    return v;
  };
}

describe('relic bank', () => {
  it('has no duplicate names or adjectives', () => {
    const names = RELIC_BANK.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(RELIC_ADJECTIVES).size).toBe(RELIC_ADJECTIVES.length);
  });

  it('covers all four categories', () => {
    const categories = new Set(RELIC_BANK.map((entry) => entry.category));
    const expected: RelicCategory[] = ['person', 'relic', 'spell', 'weapon'];
    for (const category of expected) expect(categories.has(category)).toBe(true);
  });

  it('spans all four universes', () => {
    const names = RELIC_BANK.map((entry) => entry.name);
    expect(names).toContain('Gungnir'); // norse
    expect(names).toContain('Pensieve'); // potter
    expect(names).toContain('Tesseract'); // mcu
    expect(names).toContain('Aegis'); // greek
  });
});

describe('relicTitle', () => {
  it('follows the "<Adjective> <Name>" pattern with bank members', () => {
    for (let i = 0; i < 50; i += 1) {
      const title = relicTitle();
      const space = title.indexOf(' ');
      const adjective = title.slice(0, space);
      const name = title.slice(space + 1);
      expect(RELIC_ADJECTIVES).toContain(adjective);
      expect(RELIC_BANK.map((entry) => entry.name)).toContain(name);
    }
  });

  it('is deterministic under a seeded rng', () => {
    expect(relicTitle(seqRng([0, 0]))).toBe(`${RELIC_ADJECTIVES[0]} ${RELIC_BANK[0]?.name}`);
  });
});

describe('uniqueRelicTitle', () => {
  it('avoids taken titles by retrying', () => {
    const first = relicTitle(seqRng([0, 0]));
    // rng yields the taken combo once, then a different one
    const rng = seqRng([0, 0, 0.5, 0.5]);
    const title = uniqueRelicTitle(new Set([first]), rng);
    expect(title).not.toBe(first);
    expect(title).toBe(relicTitle(seqRng([0.5, 0.5])));
  });

  it('falls back to a short suffix when every combination is taken', () => {
    const all = new Set<string>();
    for (const adjective of RELIC_ADJECTIVES) {
      for (const entry of RELIC_BANK) all.add(`${adjective} ${entry.name}`);
    }
    const title = uniqueRelicTitle(all);
    expect(all.has(title)).toBe(false);
    expect(title).toMatch(/^[^ ]+ .+ [0-9a-z]{2}$/);
  });

  it('returns a plain title when nothing collides', () => {
    const title = uniqueRelicTitle(new Set());
    expect(title).toMatch(/^[^ ]+ /);
  });
});
