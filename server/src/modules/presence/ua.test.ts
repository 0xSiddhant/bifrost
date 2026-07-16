import { describe, expect, it } from 'vitest';
import { uaLabel } from './ua.js';

describe('uaLabel', () => {
  it('labels an iPhone', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(uaLabel(ua)).toBe('iPhone · Safari');
  });

  it('labels a desktop by OS when there is no device model', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(uaLabel(ua)).toBe('macOS · Chrome');
  });

  it('labels an Android device', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    expect(uaLabel(ua)).toContain('Pixel 7 · ');
  });

  it('falls back on empty UA', () => {
    expect(uaLabel('')).toBe('Unknown device');
    expect(uaLabel('   ')).toBe('Unknown device');
  });
});
