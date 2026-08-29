import { describe, expect, it } from 'vitest';
import { isReservedRoot, RESERVED_ROOTS } from './reserved-roots.js';

describe('reserved roots', () => {
  it('reserves the go-link prefix and the api prefix themselves', () => {
    expect(isReservedRoot('go')).toBe(true);
    expect(isReservedRoot('api')).toBe(true);
  });

  it('reserves every existing top-level route root', () => {
    // A new top-level route must be added here too — otherwise its name would
    // silently become an allowable Portkey slug that shadows the real page.
    for (const root of [
      'metrics',
      'runestone',
      'edda',
      // PLAN-19: the YAML workspace, its SPA route and its raw data endpoint.
      'groot',
      'atlas',
      'variant',
      'loki',
      'accio',
      'nimbus',
      // PLAN-21 promoted the Pensieve from a nested segment to a first one.
      'pensieve',
      'portkey',
      'upload',
      'downloads',
      'hermes',
      'wardens',
      'sigil',
      'ollivanders',
      'diagon-alley',
    ]) {
      expect(RESERVED_ROOTS.has(root), `${root} is reserved`).toBe(true);
    }
  });

  it('leaves ordinary memorable words free', () => {
    for (const word of ['router', 'nas', 'standup', 'printer', 'r', 'docs-2']) {
      expect(isReservedRoot(word)).toBe(false);
    }
  });
});
