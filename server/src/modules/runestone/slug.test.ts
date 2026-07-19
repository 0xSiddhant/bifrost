import { describe, expect, it } from 'vitest';
import { idFromSlug, kebabName, makeSlug, newRunestoneId, RUNESTONE_ID_LENGTH } from './slug.js';

describe('kebabName', () => {
  it('kebab-cases and lowercases', () => {
    expect(kebabName('Gleaming Gungnir')).toBe('gleaming-gungnir');
  });

  it('strips diacritics and collapses symbol runs', () => {
    expect(kebabName('Brísingamen')).toBe('brisingamen');
    expect(kebabName('Mjölnir!!  (v2)')).toBe('mjolnir-v2');
  });

  it('returns empty for all-symbol names and trims edge dashes', () => {
    expect(kebabName('***')).toBe('');
    expect(kebabName('  -hello-  ')).toBe('hello');
  });

  it('caps length without a trailing dash', () => {
    const kebab = kebabName('a'.repeat(40) + ' ' + 'b'.repeat(40));
    expect(kebab.length).toBeLessThanOrEqual(48);
    expect(kebab.endsWith('-')).toBe(false);
  });
});

describe('makeSlug / idFromSlug', () => {
  it('appends the id, or is the bare id when the name yields nothing', () => {
    expect(makeSlug('Gleaming Gungnir', 'abc123')).toBe('gleaming-gungnir-abc123');
    expect(makeSlug('***', 'abc123')).toBe('abc123');
  });

  it('extracts an id-shaped last segment', () => {
    expect(idFromSlug('gleaming-gungnir-abc123')).toBe('abc123');
    expect(idFromSlug('abc123')).toBe('abc123');
    expect(idFromSlug('short-x1')).toBeNull();
    expect(idFromSlug('has spaces')).toBeNull();
  });

  it('round-trips: the id always comes back out of the slug', () => {
    for (const name of ['Gleaming Gungnir', '***', 'Seiðr 2.0', 'a-b-c']) {
      const id = newRunestoneId();
      expect(idFromSlug(makeSlug(name, id))).toBe(id);
    }
  });
});

describe('newRunestoneId', () => {
  it('emits lowercase alphanumerics of the fixed length', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newRunestoneId()).toMatch(new RegExp(`^[a-z0-9]{${RUNESTONE_ID_LENGTH}}$`));
    }
  });
});
