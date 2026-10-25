import { correctnessFailures, leakSlope, linearSlope } from '../report.js';
import { fire, mixedScenario } from '../scenarios.js';
import type { ProfileDefinition } from './types.js';

/** Past this, an hour would be 60 MB of growth nobody can explain. */
export const LEAK_LIMIT_MB_PER_MIN = 1;

/**
 * Does it leak or drift? The mixed scenario at half the load connections for
 * `--minutes`, `/metrics` sampled every 15 s. After the warm-up, a straight
 * line is fitted to resident memory and to heap used; either rising faster
 * than 1 MB/min fails the run. Event-loop lag and open handles are reported
 * over time: handles that climb while memory stays flat are a leak too
 * (sockets or timers), just a different kind.
 */
export const soak: ProfileDefinition = {
  sampleIntervalMs: 15_000,
  async run(context) {
    const connections = Math.max(1, Math.round(context.options.connections / 2));
    context.log(`  soak: ${connections} connections × ${context.options.minutes} min`);
    const result = await fire(mixedScenario(context.seeds), {
      baseUrl: context.baseUrl,
      connections,
      durationSeconds: context.options.minutes * 60,
      name: `soak: mixed, ${connections} connections`,
    });
    const samples = await context.sampler.stop();

    const warmup = context.options.warmupMinutes;
    const rss = leakSlope(samples, 'rssBytes', warmup);
    const heap = leakSlope(samples, 'heapUsedBytes', warmup);
    const settled = samples.filter((sample) => sample.atMs / 60_000 >= warmup);
    const handles = linearSlope(
      settled.map((sample) => [sample.atMs / 60_000, sample.activeHandles]),
    );

    const failures = correctnessFailures(result);
    let leaked = false;
    for (const [label, slope] of [
      ['resident memory', rss],
      ['heap used', heap],
    ] as const) {
      if (slope && slope.mbPerMinute > LEAK_LIMIT_MB_PER_MIN) {
        leaked = true;
        failures.push(
          `soak: ${label} grew ${slope.mbPerMinute.toFixed(2)} MB/min after the ${warmup}-minute warm-up (limit ${LEAK_LIMIT_MB_PER_MIN})`,
        );
      }
    }

    return {
      scenarios: [result],
      summary: {
        warmupMinutes: warmup,
        rssMbPerMinute: rss?.mbPerMinute ?? null,
        heapMbPerMinute: heap?.mbPerMinute ?? null,
        handlesPerMinute: handles,
        fittedSamples: rss?.samples ?? 0,
        verdict:
          rss && heap
            ? leaked
              ? 'leak'
              : 'no leak past the limit'
            : `no verdict: fewer than three samples after the ${warmup}-minute warm-up`,
        overTime: samples.map((sample) => ({
          minute: Number((sample.atMs / 60_000).toFixed(2)),
          rssMb: Number((sample.rssBytes / 2 ** 20).toFixed(1)),
          heapMb: Number((sample.heapUsedBytes / 2 ** 20).toFixed(1)),
          lagP99Ms: Number((sample.eventLoopLagP99Seconds * 1000).toFixed(2)),
          handles: sample.activeHandles,
        })),
      },
      failures,
    };
  },
};
