/**
 * Single-flight guard: one speed test at a time per server.
 *
 * Two devices transferring at once share the same Wi-Fi air and the same NIC —
 * each would measure a fraction of the real capacity and both numbers would be
 * wrong (plan: "parallel tests corrupt each other's numbers"). So the second
 * device is told "another broom is flying" (409) instead.
 *
 * A test is several requests (warmup → ping ×10 → down → up), so the lease
 * spans them: it is held by a device key, renewed by each request, and released
 * a short grace period after the last one finishes. The grace is what stops a
 * client that closed its laptop mid-test from wedging the guard forever — no
 * timer, no cleanup task, just an expiry the next caller evaluates.
 *
 * Pure and clock-injected: the whole state machine is unit-testable.
 */

/** How long the lease survives after the last in-flight request of a test ends. */
export const GUARD_GRACE_MS = 5_000;

export type AcquireResult = { ok: true } | { ok: false; holder: string };

interface Lease {
  deviceKey: string;
  since: number;
  /** In-flight requests for this lease; the grace window starts when it hits 0. */
  active: number;
  /** Once `active` is 0, the lease is free from this instant on. */
  freeAt: number;
}

export class TestGuard {
  private lease: Lease | null = null;

  constructor(private readonly graceMs: number = GUARD_GRACE_MS) {}

  /** Drops an expired lease so the next caller sees a free guard. */
  private expire(now: number): void {
    if (this.lease && this.lease.active === 0 && now >= this.lease.freeAt) this.lease = null;
  }

  /**
   * Claims (or renews) the lease for one request. Succeeding means the caller
   * must eventually call `finish` with the same key — the route does that from
   * the response's finish/close, so an aborted transfer counts as finished.
   */
  acquire(deviceKey: string, now: number): AcquireResult {
    this.expire(now);
    if (!this.lease) {
      this.lease = { deviceKey, since: now, active: 1, freeAt: now };
      return { ok: true };
    }
    if (this.lease.deviceKey !== deviceKey) return { ok: false, holder: this.lease.deviceKey };
    this.lease.active += 1;
    return { ok: true };
  }

  /** One request of the test ended (completed or aborted). */
  finish(deviceKey: string, now: number): void {
    if (!this.lease || this.lease.deviceKey !== deviceKey) return;
    this.lease.active = Math.max(0, this.lease.active - 1);
    if (this.lease.active === 0) this.lease.freeAt = now + this.graceMs;
  }

  /**
   * Gives the lease up immediately — the client says its test is over (finished
   * or cancelled), so the next device shouldn't wait out the grace window.
   */
  release(deviceKey: string): boolean {
    if (!this.lease || this.lease.deviceKey !== deviceKey) return false;
    this.lease = null;
    return true;
  }

  /** The device key currently holding a live lease, or null when the guard is free. */
  holder(now: number): string | null {
    this.expire(now);
    return this.lease?.deviceKey ?? null;
  }

  /** Snapshot for the config endpoint: is a test running, and since when. */
  state(now: number): { busy: boolean; holder: string | null; since: number | null } {
    const holder = this.holder(now);
    return { busy: holder !== null, holder, since: this.lease?.since ?? null };
  }
}
