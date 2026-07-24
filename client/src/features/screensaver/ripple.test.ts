import { describe, expect, it } from 'vitest';
import {
  advanceRipples,
  rippleAlpha,
  rippleRadius,
  RIPPLE_LIFE_MS,
  spawnRipple,
} from './ripple';

describe('ripples', () => {
  it('spawns at the point with a full life', () => {
    const r = spawnRipple(40, 60, true);
    expect(r).toMatchObject({ x: 40, y: 60, age: 0, life: RIPPLE_LIFE_MS, dismiss: true });
  });

  it('ages ripples and drops them once expired (no unbounded growth)', () => {
    let ripples = [spawnRipple(0, 0), spawnRipple(1, 1)];
    ripples = advanceRipples(ripples, RIPPLE_LIFE_MS / 2);
    expect(ripples).toHaveLength(2);
    expect(ripples[0]!.age).toBe(RIPPLE_LIFE_MS / 2);
    ripples = advanceRipples(ripples, RIPPLE_LIFE_MS);
    expect(ripples).toHaveLength(0);
  });

  it('expands while fading out', () => {
    const early = { ...spawnRipple(0, 0), age: RIPPLE_LIFE_MS * 0.2 };
    const late = { ...spawnRipple(0, 0), age: RIPPLE_LIFE_MS * 0.8 };
    expect(rippleRadius(late)).toBeGreaterThan(rippleRadius(early));
    expect(rippleAlpha(late)).toBeLessThan(rippleAlpha(early));
  });

  it('draws the dismissing ripple bolder', () => {
    const normal = { ...spawnRipple(0, 0, false), age: 100 };
    const dismiss = { ...spawnRipple(0, 0, true), age: 100 };
    expect(rippleRadius(dismiss)).toBeGreaterThan(rippleRadius(normal));
    expect(rippleAlpha(dismiss)).toBeGreaterThan(rippleAlpha(normal));
  });
});
