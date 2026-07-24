import { describe, expect, it } from 'vitest';
import { isDesktopViewport, type DesktopEnv } from './isDesktop';

const desktop: DesktopEnv = {
  matchMedia: () => ({ matches: true }),
  maxTouchPoints: 0,
  innerWidth: 1440,
};

describe('isDesktopViewport', () => {
  it('is true for a fine-pointer, touchless, wide viewport', () => {
    expect(isDesktopViewport(desktop)).toBe(true);
  });

  it('is false when a touch screen is present (laptop touchscreen / tablet)', () => {
    expect(isDesktopViewport({ ...desktop, maxTouchPoints: 5 })).toBe(false);
  });

  it('is false for a coarse pointer (phone / tablet)', () => {
    expect(isDesktopViewport({ ...desktop, matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it('is false below the desktop width threshold (iPad desktop-mode spoof)', () => {
    expect(isDesktopViewport({ ...desktop, innerWidth: 900 })).toBe(false);
  });

  it('is false when the environment is unavailable (SSR)', () => {
    expect(isDesktopViewport(null)).toBe(false);
  });
});
