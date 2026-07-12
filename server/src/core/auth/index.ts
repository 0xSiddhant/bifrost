import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';

/**
 * Auth skeleton — interfaces only. Heimdall (PLAN-05) provides the concrete
 * PIN-session implementation and routes; nothing here is reachable yet.
 */

export interface AdminSession {
  createdAt: string;
}

export interface AuthService {
  verifyPin(candidate: string): boolean;
  getSession(request: FastifyRequest): AdminSession | null;
}

/** Registers the cookie layer sessions will ride on. No routes, no handlers. */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie);
}
