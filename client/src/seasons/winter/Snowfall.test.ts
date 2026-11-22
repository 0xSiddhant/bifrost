import { describe, expect, it } from 'vitest';
import { CRYSTAL_DEPTH, CRYSTALS, fallPath, flakeCount, makeFlakes } from './Snowfall';

/** A small deterministic generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the snowfall', () => {
  it('gives a bigger screen more flakes, within bounds', () => {
    expect(flakeCount(390, 844)).toBe(50);
    expect(flakeCount(1280, 900)).toBe(165);
    expect(flakeCount(3840, 2160)).toBe(180);
  });

  it('gives each flake physics from its depth: near is larger, quicker and brighter', () => {
    const flakes = makeFlakes(400, seeded(7));
    const byDepth = [...flakes].sort((a, b) => a.depth - b.depth);
    const far = byDepth.slice(0, 50);
    const near = byDepth.slice(-50);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(near.map((f) => f.size))).toBeGreaterThan(mean(far.map((f) => f.size)) * 3);
    expect(mean(near.map((f) => f.fall))).toBeLessThan(mean(far.map((f) => f.fall)));
    expect(mean(near.map((f) => f.alpha))).toBeGreaterThan(mean(far.map((f) => f.alpha)));
    // More far flakes than near ones.
    expect(flakes.filter((f) => f.depth < 0.5).length).toBeGreaterThan(flakes.length / 2);
  });

  it('makes only the nearer flakes crystals, and softens only the nearest', () => {
    const flakes = makeFlakes(400, seeded(11));
    for (const flake of flakes) {
      if (flake.crystal !== null) {
        expect(flake.depth).toBeGreaterThanOrEqual(CRYSTAL_DEPTH);
        expect(CRYSTALS[flake.crystal]).toBeTruthy();
      }
      if (flake.soft > 0) expect(flake.depth).toBeGreaterThan(0.82);
      expect(flake.soft).toBeLessThanOrEqual(1);
      // Already mid-fall when the sky appears, and never a frozen sway.
      expect(flake.delay).toBeLessThanOrEqual(0);
      expect(flake.delay).toBeGreaterThan(-flake.fall);
      expect(flake.sway).toBeGreaterThan(0);
    }
    expect(flakes.some((f) => f.crystal !== null)).toBe(true);
    expect(flakes.some((f) => f.crystal === null && f.depth >= CRYSTAL_DEPTH)).toBe(true);
  });

  it('draws three six-armed crystal designs', () => {
    expect(CRYSTALS).toHaveLength(3);
    for (const d of CRYSTALS) expect((d.match(/M12\.00 12\.00L/g) ?? []).length).toBe(6);
  });
});

describe('fallPath', () => {
  it('falls from above the screen to below it, swaying within its reach, in one path', () => {
    for (const flake of makeFlakes(60, seeded(5))) {
      const frames = fallPath(flake);
      const points = frames.map((frame) => {
        const [x, y] = String(frame.translate).split(' ');
        return { x: Number.parseFloat(x ?? ''), y: Number.parseFloat(y ?? '') };
      });
      // Off screen at both ends, wherever it rests: the wrap is never seen.
      expect(flake.y + points[0]!.y).toBeCloseTo(-4, 1);
      expect(flake.y + points.at(-1)!.y).toBeCloseTo(104, 1);
      // Steadily down, and never further aside than its own sway.
      for (let i = 1; i < points.length; i += 1) {
        expect(points[i]!.y).toBeGreaterThan(points[i - 1]!.y);
      }
      expect(Math.max(...points.map((point) => Math.abs(point.x)))).toBeLessThanOrEqual(
        flake.sway + 0.05,
      );
      // Enough points that each half-swing reads as a curve.
      expect(frames.length - 1).toBeGreaterThanOrEqual((flake.fall / flake.swayTime) * 6);
    }
  });
});
