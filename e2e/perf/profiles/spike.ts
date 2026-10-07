import http from 'node:http';
import { correctnessFailures } from '../report.js';
import { fire, mixedScenario } from '../scenarios.js';
import type { ProfileDefinition } from './types.js';

export const IDLE_BEFORE_MS = 10_000;
export const SPIKE_SECONDS = 10;
export const IDLE_AFTER_MS = 30_000;
/** Recovered when the probe's p99 is within 20% of the pre-spike value… */
export const RECOVERY_FACTOR = 1.2;
/** …or within 5 ms of it: an idle p99 is a millisecond or two, and 20% of that is noise. */
export const RECOVERY_FLOOR_MS = 5;
/** The window a recovered p99 is measured over. */
export const RECOVERY_WINDOW_MS = 2_000;

export interface ProbeSample {
  /** When the request was sent, ms since the probe started. */
  atMs: number;
  latencyMs: number;
  /** HTTP status, or 0 for a connection error or timeout. */
  status: number;
}

export function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)] ?? NaN;
}

/**
 * The first moment at or after `fromMs` from which a full window of probe
 * samples has its p99 within bound, or null if the probe never got there.
 * A window with a gap in it (a request still stuck in the burst's queue) is
 * not recovered yet; only running out of samples ends the search.
 */
export function recoveryAt(samples: ProbeSample[], fromMs: number, boundMs: number): number | null {
  const after = samples.filter((sample) => sample.atMs >= fromMs);
  const lastSentMs = after.at(-1)?.atMs ?? fromMs;
  for (const [index, start] of after.entries()) {
    if (start.atMs + RECOVERY_WINDOW_MS * 0.75 > lastSentMs) return null;
    const window = after
      .slice(index)
      .filter((sample) => sample.atMs < start.atMs + RECOVERY_WINDOW_MS);
    const last = window.at(-1) ?? start;
    if (last.atMs < start.atMs + RECOVERY_WINDOW_MS * 0.75) continue;
    if (
      percentile(
        window.map((sample) => sample.latencyMs),
        0.99,
      ) <= boundMs
    )
      return start.atMs;
  }
  return null;
}

/** The probe's p99 and request count for each second of the run. */
export function bySecond(
  samples: ProbeSample[],
): { second: number; p99Ms: number; requests: number }[] {
  const buckets = new Map<number, number[]>();
  for (const sample of samples) {
    const second = Math.floor(sample.atMs / 1000);
    buckets.set(second, [...(buckets.get(second) ?? []), sample.latencyMs]);
  }
  return [...buckets.entries()].map(([second, latencies]) => ({
    second,
    p99Ms: Number(percentile(latencies, 0.99).toFixed(1)),
    requests: latencies.length,
  }));
}

/** One connection, one request at a time, for as long as `running()` says. */
async function probe(
  baseUrl: string,
  path: string,
  running: () => boolean,
): Promise<ProbeSample[]> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const samples: ProbeSample[] = [];
  const started = performance.now();
  try {
    while (running()) {
      const sent = performance.now();
      const status = await new Promise<number>((resolve) => {
        const request = http.get(`${baseUrl}${path}`, { agent, timeout: 10_000 }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        });
        request.on('timeout', () => request.destroy());
        request.on('error', () => resolve(0));
      });
      samples.push({ atMs: sent - started, latencyMs: performance.now() - sent, status });
    }
  } finally {
    agent.destroy();
  }
  return samples;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Does it recover? A one-connection probe runs the whole time, timing every
 * request: 10 s with nothing else, 10 s while the mixed scenario runs at ten
 * times the load connections, then 30 s with nothing else again. The pre-spike
 * p99 is the probe's own; recovery is the first point after the burst where a
 * window of probe requests is back within bound.
 */
export const spike: ProfileDefinition = {
  sampleIntervalMs: 1_000,
  async run(context) {
    let running = true;
    const probePath = '/api/runestone?paged=true';
    const probing = probe(context.baseUrl, probePath, () => running);
    const probeStart = performance.now();

    await sleep(IDLE_BEFORE_MS);
    const spikeStartMs = performance.now() - probeStart;
    const connections = context.options.connections * 10;
    context.log(`  spike: ${connections} connections × ${SPIKE_SECONDS} s`);
    const burst = await fire(mixedScenario(context.seeds), {
      baseUrl: context.baseUrl,
      connections,
      durationSeconds: SPIKE_SECONDS,
      name: `spike: ${connections} connections`,
    });
    const spikeEndMs = performance.now() - probeStart;
    await sleep(IDLE_AFTER_MS);
    running = false;
    const samples = await probing;

    const before = samples.filter((sample) => sample.atMs < spikeStartMs);
    const preP99 = percentile(
      before.map((sample) => sample.latencyMs),
      0.99,
    );
    const bound = Math.max(preP99 * RECOVERY_FACTOR, preP99 + RECOVERY_FLOOR_MS);
    const recovered = recoveryAt(samples, spikeEndMs, bound);
    const during = samples.filter(
      (sample) => sample.atMs >= spikeStartMs && sample.atMs < spikeEndMs,
    );

    const failures = correctnessFailures(burst);
    if (recovered === null) {
      failures.push(
        `spike: the probe's p99 never came back within ${bound.toFixed(1)} ms in ${IDLE_AFTER_MS / 1000} s`,
      );
    } else {
      const late = samples.filter((sample) => sample.atMs >= recovered && sample.status !== 200);
      if (late.length > 0)
        failures.push(`spike: ${late.length} probe requests failed after recovery`);
    }
    const probeErrors = samples.filter((sample) => sample.status !== 200).length;

    return {
      scenarios: [burst],
      summary: {
        probe: `GET ${probePath}, one connection`,
        probeRequests: samples.length,
        probeErrors,
        preSpikeP99Ms: preP99,
        duringSpikeP99Ms: percentile(
          during.map((sample) => sample.latencyMs),
          0.99,
        ),
        recoveryBoundMs: bound,
        recoveryMs: recovered === null ? null : recovered - spikeEndMs,
        spikeStartSecond: Math.floor(spikeStartMs / 1000),
        spikeEndSecond: Math.floor(spikeEndMs / 1000),
        // The probe second by second, so a result shows how recovery went.
        probeBySecond: bySecond(samples),
      },
      failures,
    };
  },
};
