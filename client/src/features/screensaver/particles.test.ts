import { describe, expect, it } from 'vitest';
import {
  createField,
  nearPairs,
  step,
  easePan,
  focusFactor,
  LAYERS,
  LINK_DISTANCE,
  PAN_FRACTION,
} from './particles';

/** Deterministic RNG so field construction/stepping is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('createField', () => {
  it('builds a world larger than the viewport for the camera to pan across', () => {
    const f = createField({ width: 1440, height: 900, density: 'medium', motion: 'normal', rng: mulberry32(1) });
    expect(f.worldW).toBeGreaterThan(f.width);
    expect(f.worldH).toBeGreaterThan(f.height);
    expect(f.padX).toBeGreaterThan(0);
    expect(f.panX).toBeCloseTo(1440 * PAN_FRACTION, 5);
    for (const p of f.particles) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(f.worldW);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(f.worldH);
      expect(p.depth).toBeGreaterThanOrEqual(0);
      expect(p.depth).toBeLessThan(LAYERS);
    }
  });

  it('scales the particle count up with the density band', () => {
    const opts = { width: 1440, height: 900, motion: 'normal' as const, rng: mulberry32(1) };
    const low = createField({ ...opts, density: 'low', rng: mulberry32(1) }).particles.length;
    const medium = createField({ ...opts, density: 'medium', rng: mulberry32(1) }).particles.length;
    const high = createField({ ...opts, density: 'high', rng: mulberry32(1) }).particles.length;
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
    // The larger world means noticeably more particles than the raw band count.
    expect(medium).toBeGreaterThan(130);
  });

  it('is deterministic for a fixed seed', () => {
    const a = createField({ width: 500, height: 500, density: 'medium', motion: 'calm', rng: mulberry32(42) });
    const b = createField({ width: 500, height: 500, density: 'medium', motion: 'calm', rng: mulberry32(42) });
    expect(a.particles).toEqual(b.particles);
  });

  it('gives nearer layers larger, brighter particles', () => {
    const field = createField({ width: 800, height: 800, density: 'high', motion: 'normal', rng: mulberry32(7) });
    const far = field.particles.filter((p) => p.depth === 0);
    const near = field.particles.filter((p) => p.depth === LAYERS - 1);
    const avgSize = (ps: typeof field.particles) => ps.reduce((s, p) => s + p.size, 0) / ps.length;
    expect(near.length).toBeGreaterThan(0);
    expect(avgSize(near)).toBeGreaterThan(avgSize(far));
  });
});

describe('step', () => {
  it('moves particles by their velocity and wraps at the world edges', () => {
    const field = createField({ width: 100, height: 100, density: 'low', motion: 'normal', rng: mulberry32(3) });
    const p = field.particles[0]!;
    p.x = field.worldW - 1;
    p.y = 50;
    p.vx = 50; // px/sec → +50 over 1000ms, crosses the right edge
    p.vy = 0;
    step(field, 1000);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(field.worldW);
  });
});

describe('easePan', () => {
  it('is a signed square that clamps to [-1, 1] and stays gentle near centre', () => {
    expect(easePan(0)).toBe(0);
    expect(easePan(1)).toBe(1);
    expect(easePan(-1)).toBe(-1);
    expect(easePan(0.5)).toBeCloseTo(0.25, 5); // gentler than linear near the middle
    expect(easePan(-0.5)).toBeCloseTo(-0.25, 5);
    expect(easePan(3)).toBe(1); // clamped
  });
});

describe('focusFactor', () => {
  it('is full at the centre and falls to zero past the rim', () => {
    expect(focusFactor(720, 450, 1440, 900)).toBeCloseTo(1, 5); // dead centre
    const mid = focusFactor(1150, 450, 1440, 900);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(focusFactor(0, 0, 1440, 900)).toBe(0); // far corner, past the rim
  });

  it('is symmetric about the centre', () => {
    const left = focusFactor(400, 450, 1440, 900);
    const right = focusFactor(1440 - 400, 450, 1440, 900);
    expect(left).toBeCloseTo(right, 5);
  });
});

describe('nearPairs', () => {
  it('links only far-layer particles within the threshold', () => {
    const base = { width: 500, height: 500, worldW: 500, worldH: 500, padX: 0, padY: 0, panX: 0, panY: 0 };
    const field = {
      ...base,
      particles: [
        { x: 0, y: 0, vx: 0, vy: 0, depth: 0, size: 1, alpha: 1, phase: 0, twinkle: 0 },
        { x: 10, y: 0, vx: 0, vy: 0, depth: 0, size: 1, alpha: 1, phase: 0, twinkle: 0 },
        { x: 0, y: 5, vx: 0, vy: 0, depth: 3, size: 1, alpha: 1, phase: 0, twinkle: 0 }, // non-far layer, ignored
        { x: 999, y: 999, vx: 0, vy: 0, depth: 0, size: 1, alpha: 1, phase: 0, twinkle: 0 }, // too far
      ],
    };
    const links = nearPairs(field);
    expect(links).toHaveLength(1);
    expect(links[0]!.strength).toBeCloseTo(1 - 10 / LINK_DISTANCE, 5);
  });
});
