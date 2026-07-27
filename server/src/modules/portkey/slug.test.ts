import { describe, expect, it } from 'vitest';
import { looksLikeSlug, SLUG_MAX_LENGTH, validateSlug } from './slug.js';

const ok = (raw: string) => validateSlug(raw).ok;

describe('validateSlug', () => {
  it('accepts memorable lowercase kebab words', () => {
    for (const slug of ['router', 'nas', 'standup', 'r', 'go-2', 'wifi-5g', 'a1']) {
      const result = validateSlug(slug);
      expect(result.ok, slug).toBe(true);
      if (result.ok) expect(result.slug).toBe(slug);
    }
  });

  it('trims surrounding whitespace but never rewrites the word', () => {
    const result = validateSlug('  router  ');
    expect(result).toEqual({ ok: true, slug: 'router' });
  });

  it('rejects uppercase (lowercase kebab only)', () => {
    expect(ok('Router')).toBe(false);
    expect(ok('NAS')).toBe(false);
  });

  it('rejects unicode / accented / emoji slugs', () => {
    expect(ok('café')).toBe(false);
    expect(ok('rúna')).toBe(false);
    expect(ok('🔥')).toBe(false);
  });

  it('rejects spaces, dots, slashes and other punctuation', () => {
    for (const bad of ['my router', 'a.b', 'a/b', 'a_b', 'a:b', 'a?b']) {
      expect(ok(bad), bad).toBe(false);
    }
  });

  it('rejects leading/trailing/only dashes and the empty string', () => {
    for (const bad of ['', '   ', '-', '--', '-router', 'router-']) {
      expect(ok(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it(`rejects slugs longer than ${SLUG_MAX_LENGTH} chars`, () => {
    expect(ok('a'.repeat(SLUG_MAX_LENGTH))).toBe(true);
    expect(ok('a'.repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });

  it('rejects reserved route roots with a reason', () => {
    for (const reserved of ['go', 'api', 'runestone', 'edda', 'portkey', 'diagon-alley']) {
      const result = validateSlug(reserved);
      expect(result.ok, reserved).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/reserved/i);
    }
  });
});

describe('looksLikeSlug', () => {
  it('matches the accepted shape without the reserved-word check', () => {
    expect(looksLikeSlug('router')).toBe(true);
    // reserved words are still slug-shaped — the route resolves them, the create
    // path rejects them.
    expect(looksLikeSlug('go')).toBe(true);
    expect(looksLikeSlug('Router')).toBe(false);
    expect(looksLikeSlug('-x')).toBe(false);
  });
});
