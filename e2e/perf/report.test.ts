import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MetricsSnapshot } from './metrics.js';
import {
  badCount,
  compareToBaseline,
  correctnessFailures,
  formatComparison,
  formatScenarios,
  leakSlope,
  linearSlope,
  readResult,
  writeResult,
  type RunResult,
  type ScenarioResult,
} from './report.js';

const MB = 2 ** 20;

function scenario(name: string, overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    name,
    connections: 20,
    durationSeconds: 20,
    requests: 1000,
    requestsPerSecond: 1000,
    latencyMs: { mean: 9, p50: 8, p90: 12, p99: 20, max: 40 },
    bytesPerSecond: MB,
    statusCounts: { '200': 1000 },
    errors: 0,
    timeouts: 0,
    unexpected: 0,
    ...overrides,
  };
}

function run(scenarios: ScenarioResult[]): RunResult {
  return {
    schema: 1,
    profile: 'load',
    startedAt: '2026-10-07T12:00:00.000Z',
    machine: {
      commit: 'abc',
      node: 'v22',
      os: 'linux',
      cpuModel: 'cpu',
      cores: 4,
      totalMemoryBytes: 1,
    },
    settings: {},
    serverEnv: {},
    seeding: null,
    scenarios,
    metrics: [],
    summary: {},
    failures: [],
  };
}

/** One sample a minute, the memory figure from `mbAt(minute)`. */
function series(minutes: number, mbAt: (minute: number) => number): MetricsSnapshot[] {
  return Array.from({ length: minutes + 1 }, (_, minute) => ({
    atMs: minute * 60_000,
    rssBytes: mbAt(minute) * MB,
    heapUsedBytes: mbAt(minute) * MB,
    heapTotalBytes: 0,
    eventLoopLagP99Seconds: 0,
    eventLoopLagMeanSeconds: 0,
    activeHandles: 0,
    openFds: null,
    gcSecondsTotal: 0,
    sseClients: null,
  }));
}

describe('compareToBaseline', () => {
  it('reports the signed change and flags only a move the wrong way past 10%', () => {
    const baseline = run([scenario('read: health')]);
    const current = run([
      scenario('read: health', {
        requestsPerSecond: 850,
        latencyMs: { mean: 9, p50: 8.4, p90: 12, p99: 30, max: 40 },
      }),
    ]);
    const rows = compareToBaseline(current, baseline);
    expect(rows).toEqual([
      expect.objectContaining({ metric: 'req/s', deltaPct: -15, flagged: true }),
      expect.objectContaining({ metric: 'p50', flagged: false }),
      expect.objectContaining({ metric: 'p99', deltaPct: 50, flagged: true }),
    ]);
    expect(rows[1]!.deltaPct).toBeCloseTo(5);
  });

  it('never flags an improvement, however large', () => {
    const rows = compareToBaseline(
      run([
        scenario('a', {
          requestsPerSecond: 3000,
          latencyMs: { mean: 1, p50: 1, p90: 1, p99: 2, max: 3 },
        }),
      ]),
      run([scenario('a')]),
    );
    expect(rows.every((row) => !row.flagged)).toBe(true);
  });

  it('skips scenarios missing from either side, and honours a custom threshold', () => {
    const baseline = run([scenario('a'), scenario('only before')]);
    const current = run([scenario('a', { requestsPerSecond: 930 }), scenario('only now')]);
    expect(compareToBaseline(current, baseline).map((row) => row.scenario)).toEqual([
      'a',
      'a',
      'a',
    ]);
    expect(compareToBaseline(current, baseline, 5)[0]!.flagged).toBe(true);
    expect(formatComparison(compareToBaseline(current, baseline, 5))).toContain('⚠ worse');
  });
});

describe('leak slope', () => {
  it('is zero on a flat series', () => {
    expect(
      leakSlope(
        series(60, () => 200),
        'rssBytes',
        10,
      )!.mbPerMinute,
    ).toBeCloseTo(0);
  });

  it('recovers a linear growth rate', () => {
    const slope = leakSlope(
      series(60, (minute) => 200 + 1.5 * minute),
      'rssBytes',
      10,
    )!;
    expect(slope.mbPerMinute).toBeCloseTo(1.5);
    expect(slope.samples).toBe(51);
  });

  it('stays well under 1 MB/min on noisy but flat memory', () => {
    // ±8 MB of deterministic jitter around a flat line.
    const noisy = series(60, (minute) => 300 + 8 * Math.sin(minute * 1.7) + (minute % 3) * 2);
    expect(Math.abs(leakSlope(noisy, 'heapUsedBytes', 10)!.mbPerMinute)).toBeLessThan(0.5);
  });

  it('ignores the warm-up climb', () => {
    // 100 MB → 400 MB over the first 10 minutes, then flat.
    const warm = series(60, (minute) => (minute < 10 ? 100 + 30 * minute : 400));
    expect(leakSlope(warm, 'rssBytes', 10)!.mbPerMinute).toBeCloseTo(0);
    expect(leakSlope(warm, 'rssBytes', 0)!.mbPerMinute).toBeGreaterThan(1);
  });

  it('has no verdict without enough samples after the warm-up', () => {
    expect(
      leakSlope(
        series(11, () => 1),
        'rssBytes',
        10,
      ),
    ).toBeNull();
    expect(
      linearSlope([
        [1, 1],
        [1, 2],
        [1, 3],
      ]),
    ).toBeNull();
  });
});

describe('correctness', () => {
  it('names every kind of failure', () => {
    expect(correctnessFailures(scenario('ok'))).toEqual([]);
    const failures = correctnessFailures(
      scenario('bad', {
        statusCounts: { '200': 10, '404': 2, '503': 1 },
        errors: 1,
        timeouts: 2,
        unexpected: 3,
      }),
    );
    expect(failures).toEqual([
      'bad: 1 5xx responses',
      'bad: 1 connection errors',
      'bad: 2 timeouts',
      'bad: 3 unexpected statuses (200×10 404×2 503×1)',
    ]);
  });

  it('counts a 5xx once, though it is also an unexpected status', () => {
    // The forced-5xx run: every 500 was both, and the table showed twice the count.
    expect(badCount(scenario('a', { statusCounts: { '500': 7 }, unexpected: 7 }))).toBe(7);
    expect(
      badCount(scenario('b', { statusCounts: { '200': 5, '404': 2, '500': 1 }, unexpected: 3 })),
    ).toBe(3);
    expect(badCount(scenario('c', { errors: 1, timeouts: 2 }))).toBe(3);
  });
});

describe('result files', () => {
  it('round-trip, with a filename-safe timestamp', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-perf-report-'));
    try {
      const file = writeResult(run([scenario('a')]), dir);
      expect(path.basename(file)).toBe('load-2026-10-07T12-00-00.000Z.json');
      expect(readResult(file).scenarios[0]!.name).toBe('a');
      fs.writeFileSync(path.join(dir, 'other.json'), '{"hello":1}');
      expect(() => readResult(path.join(dir, 'other.json'))).toThrow(/not a load result/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders a table with a bad-response column', () => {
    const text = formatScenarios([scenario('read: health', { unexpected: 2 })]);
    expect(text).toMatch(/read: health\s+20\s+1000\s+8\.0\s+12\.0\s+20\.0\s+40\.0\s+1\.00\s+2/);
  });
});
