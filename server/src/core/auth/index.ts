import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import secureSession from '@fastify/secure-session';
import { AppError } from '../http/index.js';

/**
 * PIN-session auth for Heimdall (PLAN-05). This is core, not a module: the
 * `requireAdmin` guard protects both the heimdall routes and the theme-mutation
 * routes, and modules may not import each other. The session cookie is an
 * encrypted, httpOnly @fastify/secure-session cookie; the panel is LAN-only.
 */

/** Sliding session lifetime. */
export const SESSION_TTL_MS = 30 * 60 * 1000;
const COOKIE_NAME = 'bifrost_admin';

interface AdminSessionData {
  /** Session epoch at issue time — a mismatch means "revoke all" was pressed. */
  epoch: number;
  /** Absolute expiry (epoch ms); slid forward on each authorized request. */
  expiresAt: number;
}

/**
 * Holds the admin PIN and the monotonically-increasing session epoch. Bumping
 * the epoch invalidates every outstanding cookie at once ("revoke all"). The
 * epoch is persisted so a restart doesn't silently un-revoke sessions.
 */
export class AuthService {
  private epoch: number;

  constructor(
    private readonly pin: string,
    initialEpoch: number,
    private readonly persistEpoch: (epoch: number) => void,
  ) {
    this.epoch = Number.isInteger(initialEpoch) && initialEpoch >= 0 ? initialEpoch : 0;
  }

  /** Constant-time PIN check — no early-return length leak. */
  verifyPin(candidate: string): boolean {
    const a = Buffer.from(String(candidate));
    const b = Buffer.from(this.pin);
    if (a.length !== b.length) {
      timingSafeEqual(a, a);
      return false;
    }
    return timingSafeEqual(a, b);
  }

  get currentEpoch(): number {
    return this.epoch;
  }

  /** Invalidate every live session. */
  revokeAll(): void {
    this.epoch += 1;
    this.persistEpoch(this.epoch);
  }
}

/** Start a session on the current request after a successful PIN check. */
export function openAdminSession(request: FastifyRequest, auth: AuthService): void {
  request.session.set('epoch', auth.currentEpoch);
  request.session.set('expiresAt', Date.now() + SESSION_TTL_MS);
}

/** End the session on the current request. */
export function closeAdminSession(request: FastifyRequest): void {
  request.session.delete();
}

function readSession(request: FastifyRequest): AdminSessionData | null {
  const epoch = request.session.get('epoch');
  const expiresAt = request.session.get('expiresAt');
  if (typeof epoch !== 'number' || typeof expiresAt !== 'number') return null;
  return { epoch, expiresAt };
}

/**
 * Registers the secure-session cookie layer and the `app.requireAdmin` guard.
 * Called once at the composition root, so every child plugin scope inherits it.
 */
export async function registerAuth(
  app: FastifyInstance,
  options: { sessionSecret: string | null; auth: AuthService },
): Promise<void> {
  // 32-byte secretbox key: derived from the configured secret (stable across
  // restarts) or random (ephemeral — sessions reset on restart).
  const key = options.sessionSecret
    ? createHash('sha256').update(options.sessionSecret).digest()
    : randomBytes(32);

  await app.register(secureSession, {
    key,
    cookieName: COOKIE_NAME,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      // http on the LAN — no `secure` flag, or the cookie would never be set.
      maxAge: SESSION_TTL_MS / 1000,
    },
  });

  const requireAdmin: preHandlerHookHandler = (request, _reply, done) => {
    const session = readSession(request);
    const now = Date.now();
    if (!session || session.epoch !== options.auth.currentEpoch || session.expiresAt <= now) {
      if (session) request.session.delete();
      done(new AppError('admin session required', 401, 'UNAUTHORIZED'));
      return;
    }
    // Slide the expiry forward — secure-session re-issues the cookie on change.
    request.session.set('expiresAt', now + SESSION_TTL_MS);
    done();
  };

  app.decorate('requireAdmin', requireAdmin);
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler that 401s any request without a live admin session. */
    requireAdmin: preHandlerHookHandler;
  }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    epoch: number;
    expiresAt: number;
  }
}
