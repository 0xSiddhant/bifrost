import { correctnessFailures } from '../report.js';
import { fire, mixedScenario, readScenarios, writeScenarios } from '../scenarios.js';
import type { ProfileDefinition } from './types.js';

/**
 * What does normal look like? Every read, write and mixed scenario at a fixed
 * connection count for a fixed time, one after the other: the baseline every
 * other profile and every later run is read against.
 */
export const load: ProfileDefinition = {
  sampleIntervalMs: 5_000,
  async run(context) {
    const scenarios = [
      ...readScenarios(context.seeds),
      ...writeScenarios(),
      mixedScenario(context.seeds),
    ];
    const results = [];
    for (const [index, scenario] of scenarios.entries()) {
      context.log(`  [${index + 1}/${scenarios.length}] ${scenario.name}`);
      results.push(
        await fire(scenario, {
          baseUrl: context.baseUrl,
          connections: context.options.connections,
          durationSeconds: context.options.durationSeconds,
        }),
      );
    }
    return {
      scenarios: results,
      summary: {
        scenarioCount: results.length,
        totalRequests: results.reduce((total, result) => total + result.requests, 0),
      },
      failures: results.flatMap(correctnessFailures),
    };
  },
};
