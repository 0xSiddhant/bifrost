import { describe, expect, it } from 'vitest';
import { runRegex } from './regex';

describe('runRegex', () => {
  it('reports an empty pattern without evaluating', () => {
    expect(runRegex('', 'g', 'abc')).toEqual({ error: null, matches: [], empty: true });
  });

  it('reports invalid patterns instead of throwing', () => {
    const out = runRegex('(', 'g', 'abc');
    expect(out.error).toBeTruthy();
    expect(out.matches).toEqual([]);
  });

  it('finds all global matches with capture groups', () => {
    const out = runRegex('(\\w)(\\d)', 'g', 'a1 b2 c3');
    expect(out.matches).toHaveLength(3);
    expect(out.matches[0]!.text).toBe('a1');
    expect(out.matches[0]!.groups).toEqual(['a', '1']);
    expect(out.matches[0]!.index).toBe(0);
  });

  it('returns a single match without the g flag', () => {
    const out = runRegex('\\d', '', 'a1b2');
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0]!.text).toBe('1');
  });

  it('captures named groups', () => {
    const out = runRegex('(?<year>\\d{4})', 'g', '2026 and 1999');
    expect(out.matches[0]!.named.year).toBe('2026');
  });

  it('does not spin on zero-length matches', () => {
    const out = runRegex('a*', 'g', 'aabaa');
    expect(out.error).toBeNull();
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches.length).toBeLessThan(500);
  });
});
