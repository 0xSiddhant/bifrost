import { serverErrors, type ScenarioResult } from '../report.js';
import { fire, mixedScenario } from '../scenarios.js';
import type { ProfileDefinition } from './types.js';

/** The ramp: the plan's 10 → 20 → 50 → 100 → 200 …, continued to a ceiling. */
export const STRESS_STEPS = [10, 20, 50, 100, 200, 500, 1000];
export const P99_LIMIT_MS = 1_000;
export const ERROR_LIMIT = 0.01;

/** Everything that is not a good, expected answer, as a share of the requests. */
export function badShare(step: ScenarioResult): number {
  const bad = serverErrors(step) + step.errors + step.timeouts + step.unexpected;
  return step.requests + step.errors + step.timeouts === 0
    ? 1
    : bad / (step.requests + step.errors + step.timeouts);
}

export function brokeAt(step: ScenarioResult): string | null {
  if (step.latencyMs.p99 > P99_LIMIT_MS)
    return `p99 ${step.latencyMs.p99.toFixed(0)} ms > ${P99_LIMIT_MS} ms`;
  const share = badShare(step);
  if (share > ERROR_LIMIT)
    return `${(share * 100).toFixed(1)}% bad responses > ${ERROR_LIMIT * 100}%`;
  return null;
}

/**
 * Where is the knee? The mixed scenario at rising connection counts until a
 * step's p99 passes 1 s or more than 1% of its requests go wrong.
 *
 * Failing is the point of the profile, so the breaking step's timeouts and
 * connection errors are how it broke, not a bug. A 5xx is never that: the
 * server answering "I failed" is a correctness failure at any step, and so is
 * anything going wrong on a step that held.
 */
export const stress: ProfileDefinition = {
  sampleIntervalMs: 2_000,
  async run(context) {
    const scenario = mixedScenario(context.seeds);
    const steps = STRESS_STEPS;
    const results: ScenarioResult[] = [];
    const failures: string[] = [];
    let lastGood: ScenarioResult | null = null;
    let breaking: { step: ScenarioResult; reason: string } | null = null;

    for (const connections of steps) {
      context.log(`  step: ${connections} connections × ${context.options.durationSeconds} s`);
      const step = await fire(scenario, {
        baseUrl: context.baseUrl,
        connections,
        durationSeconds: context.options.durationSeconds,
        name: `stress: ${connections} connections`,
      });
      results.push(step);
      const fives = serverErrors(step);
      if (fives > 0) failures.push(`${step.name}: ${fives} 5xx responses`);
      const reason = brokeAt(step);
      if (reason) {
        breaking = { step, reason };
        break;
      }
      const slips = step.errors + step.timeouts + step.unexpected;
      if (slips > 0) {
        failures.push(
          `${step.name}: ${slips} errors, timeouts or unexpected statuses on a step that held`,
        );
      }
      lastGood = step;
    }

    return {
      scenarios: results,
      summary: {
        lastGoodConnections: lastGood?.connections ?? null,
        lastGoodRequestsPerSecond: lastGood?.requestsPerSecond ?? null,
        lastGoodP99Ms: lastGood?.latencyMs.p99 ?? null,
        brokeAtConnections: breaking?.step.connections ?? null,
        brokeBecause: breaking?.reason ?? `held at every step up to ${steps.at(-1)} connections`,
      },
      failures,
    };
  },
};
