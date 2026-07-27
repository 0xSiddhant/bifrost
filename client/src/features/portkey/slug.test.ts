import { describe, expect, it } from 'vitest';
import { isValidSlugFormat, slugFormatError, SLUG_MAX_LENGTH, suggestSlug, tidySlug } from './slug';

describe('slugFormatError', () => {
  it('passes memorable lowercase kebab words and the empty field', () => {
    expect(slugFormatError('router')).toBeNull();
    expect(slugFormatError('wifi-5g')).toBeNull();
    expect(slugFormatError('')).toBeNull();
  });

  it('flags uppercase, spaces and stray punctuation', () => {
    expect(slugFormatError('Router')).toMatch(/lowercase/);
    expect(slugFormatError('my router')).toMatch(/lowercase/);
    expect(slugFormatError('a.b')).toMatch(/lowercase/);
  });

  it('flags over-length slugs', () => {
    expect(slugFormatError('a'.repeat(33))).toMatch(/max/);
  });
});

describe('isValidSlugFormat', () => {
  it('agrees with the error check', () => {
    expect(isValidSlugFormat('router')).toBe(true);
    expect(isValidSlugFormat('Router')).toBe(false);
    expect(isValidSlugFormat('-x')).toBe(false);
    expect(isValidSlugFormat('')).toBe(false);
  });
});

describe('suggestSlug', () => {
  it('offers the first free numeric variant', () => {
    expect(suggestSlug('router', new Set(['router']))).toBe('router-2');
    expect(suggestSlug('router', new Set(['router', 'router-2', 'router-3']))).toBe('router-4');
  });

  it('always returns a validly-formatted, non-taken slug within the length cap', () => {
    const long = 'a'.repeat(SLUG_MAX_LENGTH);
    const taken = new Set([long]);
    const suggestion = suggestSlug(long, taken);
    expect(suggestion.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(isValidSlugFormat(suggestion)).toBe(true);
    expect(taken.has(suggestion)).toBe(false);
  });

  it('falls back past -99 without returning a taken slug', () => {
    const taken = new Set(['x', ...Array.from({ length: 98 }, (_v, i) => `x-${i + 2}`)]);
    const suggestion = suggestSlug('x', taken);
    expect(taken.has(suggestion)).toBe(false);
    expect(isValidSlugFormat(suggestion)).toBe(true);
  });
});

describe('tidySlug', () => {
  it('lowercases and dashes out unusable characters for a paste-friendly nudge', () => {
    expect(tidySlug('My Router!')).toBe('my-router-');
    expect(tidySlug('CAFÉ')).toBe('caf-');
    expect(tidySlug('  --router')).toBe('router');
  });
});
