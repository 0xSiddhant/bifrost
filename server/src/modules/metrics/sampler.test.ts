import { describe, expect, it } from 'vitest';
import { MetricsSampler, type SamplerDeps } from './sampler.js';

/** Everything injected: no real timers, no real process, no real disk. */
function harness(overrides: Partial<SamplerDeps> = {}) {
  const state = {
    cpu: { user: 0, system: 0 },
    memory: { rss: 100 * 1024 * 1024, heapUsed: 40 * 1024 * 1024 },
    lag: { p50: 1e6, p99: 5e6 },
    clients: 0,
    uptime: 0,
    now: 0,
    resets: 0,
  };
  const deps: SamplerDeps = {
    cpuUsage: () => ({ ...state.cpu }),
    memoryUsage: () => ({ ...state.memory }),
    loopLag: {
      percentile: (p) => (p === 50 ? state.lag.p50 : state.lag.p99),
      reset: () => {
        state.resets += 1;
      },
    },
    sseClients: () => state.clients,
    uptimeSec: () => state.uptime,
    now: () => state.now,
    ...overrides,
  };
  return { state, sampler: new MetricsSampler(deps) };
}

describe('CPU percent', () => {
  it('reads 100% for one core saturated across the interval', () => {
    const { state, sampler } = harness();
    state.now = 60_000; // 60s of wall time
    state.cpu = { user: 60_000_000, system: 0 }; // 60s of CPU (microseconds)
    expect(sampler.sample().cpuPct).toBe(100);
  });

  it('reads over 100% when more than one core is busy, like top does', () => {
    const { state, sampler } = harness();
    state.now = 60_000;
    state.cpu = { user: 90_000_000, system: 30_000_000 }; // 120s of CPU in 60s
    expect(sampler.sample().cpuPct).toBe(200);
  });

  it('measures each interval separately rather than since boot', () => {
    const { state, sampler } = harness();
    state.now = 60_000;
    state.cpu = { user: 60_000_000, system: 0 };
    expect(sampler.sample().cpuPct).toBe(100);

    // Second interval: idle. A cumulative reading would still say ~100%.
    state.now = 120_000;
    expect(sampler.sample().cpuPct).toBe(0);
  });

  it('never reports a negative percentage', () => {
    const { state, sampler } = harness();
    state.now = 1000;
    state.cpu = { user: -5_000, system: 0 };
    expect(sampler.sample().cpuPct).toBe(0);
  });
});

describe('upload deltas', () => {
  it('reports what happened in this interval and resets', () => {
    const { state, sampler } = harness();
    sampler.recordUpload();
    sampler.recordUpload();
    state.now = 60_000;
    expect(sampler.sample().uploadsDelta).toBe(2);

    state.now = 120_000;
    expect(sampler.sample().uploadsDelta).toBe(0);
  });

  // The property the whole "deltas, not counters" decision rests on: summing a
  // day of snapshots must equal the day's uploads, including across a restart,
  // which a cumulative counter resetting to zero could never satisfy.
  it('sums over any window to the total number of events', () => {
    const { state, sampler } = harness();
    const perInterval = [3, 0, 7, 1, 0, 12];
    let summed = 0;
    let minute = 0;
    for (const count of perInterval) {
      for (let i = 0; i < count; i += 1) sampler.recordUpload();
      minute += 60_000;
      state.now = minute;
      summed += sampler.sample().uploadsDelta;
    }
    expect(summed).toBe(perInterval.reduce((a, b) => a + b, 0));
  });
});

describe('event-loop lag', () => {
  it('converts nanosecond percentiles to milliseconds', () => {
    const { state, sampler } = harness();
    state.lag = { p50: 1_500_000, p99: 128_000_000 };
    state.now = 60_000;
    const snapshot = sampler.sample();
    expect(snapshot.loopLagP50Ms).toBe(1.5);
    expect(snapshot.loopLagP99Ms).toBe(128);
  });

  it('resets the histogram every snapshot, so one bad minute cannot hide', () => {
    const { state, sampler } = harness();
    state.now = 60_000;
    sampler.sample();
    state.now = 120_000;
    sampler.sample();
    expect(state.resets).toBe(2);
  });
});

describe('diskMb', () => {
  // The plan's sharpest constraint: sampling the sync walk per snapshot would
  // manufacture the very lag spike the snapshot exists to detect.
  it('is null until the slow cycle has run once', () => {
    const { state, sampler } = harness();
    state.now = 60_000;
    expect(sampler.sample().diskMb).toBeNull();
  });

  it('carries the last slow-cycle value across intervening snapshots', () => {
    const { state, sampler } = harness();
    sampler.setDiskBytes(512 * 1024 * 1024);
    state.now = 60_000;
    expect(sampler.sample().diskMb).toBe(512);

    state.now = 120_000;
    expect(sampler.sample().diskMb).toBe(512);

    sampler.setDiskBytes(600 * 1024 * 1024);
    state.now = 180_000;
    expect(sampler.sample().diskMb).toBe(600);
  });
});

describe('snapshot shape', () => {
  it('carries every contracted field, with memory in MB and uptime whole', () => {
    const { state, sampler } = harness();
    state.clients = 4;
    state.uptime = 3661.7;
    state.now = 60_000;
    const snapshot = sampler.sample();
    expect(Object.keys(snapshot).sort()).toEqual([
      'cpuPct',
      'diskMb',
      'heapUsedMb',
      'loopLagP50Ms',
      'loopLagP99Ms',
      'rssMb',
      'sseClients',
      'uploadsDelta',
      'uptimeSec',
    ]);
    expect(snapshot.rssMb).toBe(100);
    expect(snapshot.heapUsedMb).toBe(40);
    expect(snapshot.sseClients).toBe(4);
    expect(snapshot.uptimeSec).toBe(3661);
  });
});
