import { CliError } from '../core/output.js';

/**
 * Awaits a call that must fail and hands back the `CliError` it raised.
 *
 * `promise.catch(e => e as CliError)` reads the same but types the result as a
 * union with the success value, so every assertion on `.message` then needs its
 * own cast — and `tsc --noEmit` catches that, while vitest never would.
 */
export async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error('expected the call to fail, but it resolved');
}
