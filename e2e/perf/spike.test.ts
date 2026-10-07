import { describe, expect, it } from 'vitest';
import { bySecond, percentile, recoveryAt, type ProbeSample } from './profiles/spike.js';

/** A probe sending every `everyMs` from `fromMs` to `toMs`, each answered in `latencyMs`. */
const steady = (fromMs: number, toMs: number, latencyMs: number, everyMs = 25): ProbeSample[] =>
  Array.from({ length: Math.floor((toMs - fromMs) / everyMs) }, (_, index) => ({
    atMs: fromMs + index * everyMs,
    latencyMs,
    status: 200,
  }));

describe('spike recovery', () => {
  it('takes the nearest rank for a percentile', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 0.99)).toBe(100);
    expect(percentile([], 0.99)).toBeNaN();
  });

  it('is the first window back within bound', () => {
    const samples = [...steady(20_000, 23_000, 400), ...steady(23_000, 50_000, 30)];
    // Windows that still hold a 400 ms request are not recovered.
    expect(recoveryAt(samples, 20_000, 40)).toBe(23_000);
  });

  it('skips a gap left by a request stuck in the burst, instead of giving up', () => {
    // The last request sent during the burst takes 4 s; nothing is sent meanwhile.
    const samples = [
      { atMs: 20_100, latencyMs: 4_200, status: 200 },
      ...steady(24_300, 50_000, 30),
    ];
    expect(recoveryAt(samples, 20_000, 40)).toBe(24_300);
  });

  it('is null when the probe never comes back, or the run ends first', () => {
    expect(recoveryAt(steady(20_000, 50_000, 400), 20_000, 40)).toBeNull();
    expect(recoveryAt(steady(20_000, 21_000, 30), 20_000, 40)).toBeNull();
    expect(recoveryAt([], 20_000, 40)).toBeNull();
  });

  it('buckets the probe by second', () => {
    const samples = [...steady(0, 1_000, 10, 250), ...steady(1_000, 2_000, 20, 500)];
    expect(bySecond(samples)).toEqual([
      { second: 0, p99Ms: 10, requests: 4 },
      { second: 1, p99Ms: 20, requests: 2 },
    ]);
  });
});
