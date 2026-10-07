import { describe, expect, it } from 'vitest';
import { uncoveredReads } from './corpus-check.js';

const spec = {
  paths: {
    '/api/runestone': { get: {}, post: {} },
    '/api/runestone/{slug}': { get: {}, put: {} },
    '/api/accio/{id}': { patch: {} },
    '/metrics': { get: {} },
    '/go/{slug}': { get: {} },
  },
};

describe('uncoveredReads', () => {
  it('names the GET templates no corpus path reaches, ignoring exclusions and other methods', () => {
    expect(uncoveredReads(spec, ['/api/runestone?paged=true'], ['/metrics'])).toEqual([
      '/api/runestone/{slug}',
      '/go/{slug}',
    ]);
  });

  it('matches one segment per parameter, never across a slash', () => {
    expect(
      uncoveredReads(spec, ['/api/runestone', '/api/runestone/a/b', '/go/x'], ['/metrics']),
    ).toEqual(['/api/runestone/{slug}']);
    expect(
      uncoveredReads(spec, ['/api/runestone', '/api/runestone/name-1a2b', '/go/x'], ['/metrics']),
    ).toEqual([]);
  });
});
