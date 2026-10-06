import type { Difference } from './compare.js';

/**
 * Intended differences between base and candidate, each with the plan that
 * makes it and why. A difference that matches no entry fails the run.
 *
 * PLAN-32 had none: every route had to answer byte for byte as it did.
 */
export interface ExpectedDifference {
  plan: string;
  reason: string;
  matches(difference: Difference): boolean;
}

export const EXPECTED_DIFFERENCES: ExpectedDifference[] = [
  {
    plan: 'PLAN-33',
    reason:
      'A document over its cap is refused by the usecase with the documented ' +
      "`413 PAYLOAD_TOO_LARGE`, no longer by Fastify's default 1 MiB body limit with " +
      '`FST_ERR_CTP_BODY_TOO_LARGE`: the document routes size their bodyLimit from the cap.',
    matches: (difference) =>
      difference.what === 'body' &&
      /^POST \/api\/(runestone|edda|groot|atlas) \(over the cap\)/.test(difference.request),
  },
];
