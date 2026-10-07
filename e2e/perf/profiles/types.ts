import type { Api } from '../../support/api.js';
import type { MetricsSampler } from '../metrics.js';
import type { RunOptions } from '../options.js';
import type { ScenarioResult } from '../report.js';
import type { Seeded } from '../seed.js';

/** Everything a profile gets from the run: a seeded server it may only reach over HTTP. */
export interface ProfileContext {
  baseUrl: string;
  api: Api;
  seeds: Seeded;
  options: RunOptions;
  /** The run's clock origin, shared with the `/metrics` samples. */
  startedAt: number;
  sampler: MetricsSampler;
  /** The scratch storage root, for the disk-space check (never written to by the harness). */
  storageRoot: string;
  log(line: string): void;
}

export interface ProfileOutcome {
  scenarios: ScenarioResult[];
  summary: Record<string, unknown>;
  /** Correctness failures; any one makes the run exit non-zero. */
  failures: string[];
}

export interface ProfileDefinition {
  /** How often `/metrics` is sampled while the profile runs. */
  sampleIntervalMs: number;
  run(context: ProfileContext): Promise<ProfileOutcome>;
}
