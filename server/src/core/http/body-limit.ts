import type { FastifyError } from 'fastify';
import { AppError } from './index.js';

/**
 * Body limits for routes whose cap is on the **decoded** text of one JSON
 * string field (PLAN-33): the four document kinds.
 *
 * Fastify's default `bodyLimit` is 1 MiB, so a `*_MAX_DOC_KB` of 2048 was
 * unreachable above ~1 MB. The limit applies to the encoded JSON, where one
 * control character costs 6 bytes (`\u0001`), so anything smaller than 6× the
 * cap would make some valid document under the cap unreachable again. 16 KiB
 * covers the envelope and the name. The exact cap stays in the usecase.
 */
export function documentBodyLimit(maxDocKb: number): number {
  return maxDocKb * 1024 * 6 + 16 * 1024;
}

/**
 * A route `errorHandler` that answers a body over the route's limit with the
 * route's own documented refusal instead of Fastify's
 * `FST_ERR_CTP_BODY_TOO_LARGE`, so a client sees one 413 code whichever check
 * caught it. Anything else goes on to the app's error handler unchanged.
 */
export function bodyTooLargeAs(message: string, code = 'PAYLOAD_TOO_LARGE') {
  return (error: FastifyError): never => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') throw new AppError(message, 413, code);
    throw error;
  };
}
