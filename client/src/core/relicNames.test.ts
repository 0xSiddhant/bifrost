import { describe, expect, it } from 'vitest';
import { RELIC_ADJECTIVES, RELIC_BANK, relicTitle, uniqueRelicTitle } from './relicNames';

describe('relicNames (client mirror of core/relics)', () => {
  it('has no duplicate names and covers all four categories', () => {
    const names = RELIC_BANK.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    const categories = new Set(RELIC_BANK.map((entry) => entry.category));
    expect([...categories].sort()).toEqual(['person', 'relic', 'spell', 'weapon']);
    expect(names).toContain('Aegis'); // greek, mirrored from core/relics
  });

  it('generates "<Adjective> <Name>" titles from the bank', () => {
    for (let i = 0; i < 50; i += 1) {
      const title = relicTitle();
      const space = title.indexOf(' ');
      expect(RELIC_ADJECTIVES).toContain(title.slice(0, space));
      expect(RELIC_BANK.map((entry) => entry.name)).toContain(title.slice(space + 1));
    }
  });

  it('avoids taken titles', () => {
    const taken = new Set([relicTitle(() => 0)]);
    const title = uniqueRelicTitle(taken, () => 0.5);
    expect(taken.has(title)).toBe(false);
  });

  it('suffixes when the whole bank is taken', () => {
    const all = new Set<string>();
    for (const adjective of RELIC_ADJECTIVES) {
      for (const entry of RELIC_BANK) all.add(`${adjective} ${entry.name}`);
    }
    const title = uniqueRelicTitle(all);
    expect(all.has(title)).toBe(false);
  });
});
