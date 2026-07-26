import { describe, expect, it } from 'vitest';
import { isValidSlugFormat, slugFormatError, tidySlug } from './slug';

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

describe('tidySlug', () => {
  it('lowercases and dashes out unusable characters for a paste-friendly nudge', () => {
    expect(tidySlug('My Router!')).toBe('my-router-');
    expect(tidySlug('CAFÉ')).toBe('caf-');
    expect(tidySlug('  --router')).toBe('router');
  });
});
