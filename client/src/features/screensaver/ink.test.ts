import { describe, expect, it } from 'vitest';
import { paintStyle } from './ink';

describe('paintStyle', () => {
  it('keeps the night numbers on a dark veil', () => {
    const style = paintStyle('rgba(6, 8, 14, 0.96)');
    expect(style.ink).toBe(false);
    expect(style.lineAlpha).toBe(0.35);
    expect(style.lineWidth).toBe(1);
    expect(style.sizeScale).toBe(1);
    expect(style.particleAlpha(0.22)).toBe(0.22);
  });

  it("draws in ink on a light veil (Yule's frost, Daybreak's parchment)", () => {
    for (const veil of ['rgba(240, 246, 251, 0.96)', 'rgba(250, 247, 241, 0.95)']) {
      const style = paintStyle(veil);
      expect(style.ink, veil).toBe(true);
      expect(style.lineAlpha).toBeGreaterThan(0.35);
      // The faintest far star stays visible, the near suns are full.
      expect(style.particleAlpha(0.22)).toBeGreaterThanOrEqual(0.5);
      expect(style.particleAlpha(0.77)).toBe(1);
    }
  });

  it('treats a colour it cannot read as night', () => {
    expect(paintStyle('not a colour').ink).toBe(false);
  });
});
