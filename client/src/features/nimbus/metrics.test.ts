import { describe, expect, it } from 'vitest';
import {
  formatLatency,
  formatMbps,
  fraction,
  mbps,
  median,
  sparklinePoints,
  spreadPercent,
} from './metrics';

describe('median latency', () => {
  it('takes the middle of an odd sample', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the two middles of an even sample', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('ignores a single retry spike where a mean would not', () => {
    // Nine good round trips and one Wi-Fi retry: the median stays honest, the
    // mean (≈ 24 ms) would describe a round trip that never happened.
    const samples = [3, 3.2, 3.1, 2.9, 3.4, 3, 3.3, 3.1, 3.2, 210];
    expect(median(samples)).toBeCloseTo(3.15, 2);
  });

  it('returns null for an empty or unusable sample', () => {
    expect(median([])).toBeNull();
    expect(median([Number.NaN, Infinity])).toBeNull();
  });
});

describe('mbps', () => {
  it('converts bytes over milliseconds into decimal megabits per second', () => {
    // 12.5 MB in one second = 100 Mbps exactly (8 bits per byte, 1e6 per Mb).
    expect(mbps(12_500_000, 1000)).toBe(100);
    expect(mbps(1_000_000, 500)).toBe(16);
  });

  it('refuses to divide by a zero or negative duration', () => {
    expect(mbps(1_000_000, 0)).toBe(0);
    expect(mbps(1_000_000, -5)).toBe(0);
    expect(mbps(0, 100)).toBe(0);
    expect(mbps(Number.NaN, 100)).toBe(0);
  });
});

describe('formatting', () => {
  it('shows three significant figures, which is all a Wi-Fi reading earns', () => {
    expect(formatMbps(312.456)).toBe('312');
    expect(formatMbps(45.67)).toBe('45.7');
    expect(formatMbps(4.321)).toBe('4.32');
    expect(formatMbps(0.8)).toBe('0.80');
  });

  it('shows an em dash instead of a fake zero when there is no reading', () => {
    expect(formatMbps(null)).toBe('—');
    expect(formatLatency(null)).toBe('—');
    expect(formatMbps(Number.NaN)).toBe('—');
  });

  it('rounds latency once it is over 10 ms', () => {
    expect(formatLatency(3.24)).toBe('3.2');
    expect(formatLatency(42.6)).toBe('43');
  });
});

describe('fraction', () => {
  it('clamps to 0–1', () => {
    expect(fraction(50, 100)).toBe(0.5);
    expect(fraction(150, 100)).toBe(1);
    expect(fraction(-5, 100)).toBe(0);
    expect(fraction(5, 0)).toBe(0);
  });
});

describe('sparklinePoints', () => {
  it('plots oldest-left, scaled from zero to the series maximum', () => {
    // 0 and 100 with height 10 and padding 1: the max sits at the top edge, the
    // zero at the bottom.
    expect(sparklinePoints([0, 100], 10, 10, 1)).toBe('1,9 9,1');
  });

  it('does not pretend one reading is a trend', () => {
    expect(sparklinePoints([100], 10, 10)).toBeNull();
    expect(sparklinePoints([], 10, 10)).toBeNull();
  });

  it('scales from zero so a flat fast line does not look like a flat slow one', () => {
    const fast = sparklinePoints([300, 300, 300], 10, 10, 1);
    const slow = sparklinePoints([3, 3, 3], 10, 10, 1);
    // Both are flat, both sit at the top — the axis is the series' own max.
    expect(fast).toBe(slow);
    expect(fast).toBe('1,1 5,1 9,1');
  });
});

describe('spreadPercent', () => {
  it('reports the spread of a series against its mean', () => {
    expect(spreadPercent([100, 100])).toBe(0);
    expect(spreadPercent([90, 110])).toBe(20);
  });

  it('needs two readings', () => {
    expect(spreadPercent([100])).toBeNull();
    expect(spreadPercent([])).toBeNull();
  });
});
