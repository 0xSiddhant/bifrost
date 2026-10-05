import type { Difference } from './compare.js';

/**
 * Intended differences between base and candidate, each with the plan that
 * makes it and why. A difference that matches no entry fails the run.
 *
 * PLAN-32 has none: every route must answer byte for byte as it did. PLAN-33's
 * fix for documents over 1 MiB being refused despite the 2048 KB caps is the
 * first expected entry; it is added in that plan's PR, not before.
 */
export interface ExpectedDifference {
  plan: string;
  reason: string;
  matches(difference: Difference): boolean;
}

export const EXPECTED_DIFFERENCES: ExpectedDifference[] = [];
