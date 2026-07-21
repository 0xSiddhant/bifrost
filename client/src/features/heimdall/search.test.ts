import { describe, expect, it } from 'vitest';
import { fuzzy, searchSections } from './search';

describe('fuzzy', () => {
  it('matches substrings and subsequences, case-insensitively', () => {
    expect(fuzzy('tap', 'Hidden tap count')).toBe(true);
    expect(fuzzy('THM', 'themes')).toBe(true); // subsequence
    expect(fuzzy('', 'anything')).toBe(true);
    expect(fuzzy('zzz', 'themes')).toBe(false);
  });
});

describe('searchSections', () => {
  it('returns nothing for an empty query', () => {
    expect(searchSections('   ')).toEqual([]);
  });

  it('jumps a control search to the owning section (acceptance 4: "tap" → Settings)', () => {
    const hits = searchSections('tap');
    const control = hits.find((hit) => hit.controlId === 'tap-count');
    expect(control).toBeDefined();
    expect(control?.sectionId).toBe('settings');
  });

  it('matches whole sections by name', () => {
    const hits = searchSections('themes');
    expect(hits.some((hit) => hit.sectionId === 'themes' && !hit.controlId)).toBe(true);
  });

  it('finds the QR control via a keyword, not just its label', () => {
    const hits = searchSections('lan');
    expect(hits.some((hit) => hit.sectionId === 'network')).toBe(true);
  });
});
