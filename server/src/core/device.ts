import type { FastifyRequest } from 'fastify';

/** Header the client sends on writes so the server can attribute them (PLAN-06). */
export const DEVICE_HEADER = 'x-bifrost-device';

/** The posting device's stable id, or null when the client didn't send one. */
export function deviceIdOf(request: FastifyRequest): string | null {
  const value = request.headers[DEVICE_HEADER];
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
}
