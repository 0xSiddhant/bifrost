import { describe, expect, it } from 'vitest';
import { legacyToV1, rewriteLegacyUrl } from './versioning.js';

describe('legacyToV1 (PLAN-37)', () => {
  it('maps an unversioned API path to v1, keeping the query string', () => {
    expect(legacyToV1('/api/health')).toBe('/api/v1/health');
    expect(legacyToV1('/api/edda/a-doc?x=1&y=/api/z')).toBe('/api/v1/edda/a-doc?x=1&y=/api/z');
    expect(legacyToV1('/api/downloads/abc/content?download=1')).toBe(
      '/api/v1/downloads/abc/content?download=1',
    );
  });

  it('leaves a versioned path, any version, untouched', () => {
    expect(legacyToV1('/api/v1/health')).toBeNull();
    expect(legacyToV1('/api/v1')).toBeNull();
    expect(legacyToV1('/api/v2/edda/x')).toBeNull();
    expect(legacyToV1('/api/v12')).toBeNull();
  });

  it('reads a first segment that only starts like a version as a module', () => {
    expect(legacyToV1('/api/v1beta/x')).toBe('/api/v1/v1beta/x');
    expect(legacyToV1('/api/version')).toBe('/api/v1/version');
  });

  it('maps a raw document path, where one segment is always the slug', () => {
    expect(legacyToV1('/runestone/api/a-doc')).toBe('/runestone/api/v1/a-doc');
    expect(legacyToV1('/edda/api/v1-notes?download=1')).toBe('/edda/api/v1/v1-notes?download=1');
    // `/runestone/api/v1` is the document whose slug is `v1`, not the version.
    expect(legacyToV1('/groot/api/v1')).toBe('/groot/api/v1/v1');
    expect(legacyToV1('/atlas/api/v1/a-doc')).toBeNull();
  });

  it('leaves everything else alone', () => {
    for (const url of [
      '/',
      '/api',
      '/api/',
      '/go/router',
      '/metrics',
      '/edda/api/',
      '/loki/api/x',
    ]) {
      expect(legacyToV1(url), url).toBeNull();
      expect(rewriteLegacyUrl({ url }), url).toBe(url);
    }
    expect(rewriteLegacyUrl({})).toBe('/');
  });
});
