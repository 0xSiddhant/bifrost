import { describe, expect, it } from 'vitest';
import { shouldShowForOrigin } from './origin';

describe('shouldShowForOrigin', () => {
  it('suppresses only when both ids are known and equal', () => {
    expect(shouldShowForOrigin('device-a', 'device-a')).toBe(false);
    expect(shouldShowForOrigin('device-a', 'device-b')).toBe(true);
  });

  // The trap: `null === null` would suppress on every client without an id.
  it('shows the notification when either id is missing', () => {
    expect(shouldShowForOrigin(null, null)).toBe(true);
    expect(shouldShowForOrigin(null, 'device-a')).toBe(true);
    expect(shouldShowForOrigin('device-a', null)).toBe(true);
    expect(shouldShowForOrigin(undefined, undefined)).toBe(true);
    expect(shouldShowForOrigin('', '')).toBe(true);
  });
});
