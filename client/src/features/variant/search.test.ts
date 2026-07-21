import { describe, expect, it } from 'vitest';
import { crossPaneOffset } from './search';

describe('crossPaneOffset (cross-pane search reveal)', () => {
  it('returns the offset of the first occurrence in the other pane', () => {
    expect(crossPaneOffset('alpha beta gamma', 'beta')).toBe(6);
    expect(crossPaneOffset('{"id":42}', '42')).toBe(6);
  });

  it('is case-insensitive so a hit on one side reveals the other', () => {
    expect(crossPaneOffset('The Bifrost Bridge', 'bifrost')).toBe(4);
  });

  it('returns null when the string is absent (no scroll)', () => {
    expect(crossPaneOffset('alpha beta', 'gamma')).toBeNull();
  });

  it('returns null for an empty query', () => {
    expect(crossPaneOffset('anything', '')).toBeNull();
  });
});
