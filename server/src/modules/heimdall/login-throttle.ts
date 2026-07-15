/**
 * Per-IP login throttle: at most `max` failures per sliding `windowMs`, with an
 * incremental delay that grows as failures accumulate. In-memory — a restart
 * clears it, which is fine (the PIN is the real gate; this is DoS insurance).
 */
export interface ThrottleDecision {
  allowed: boolean;
  /** When locked out: ms until the window frees up (for Retry-After). */
  retryAfterMs: number;
  /** When allowed: ms to stall the response before checking the PIN. */
  delayMs: number;
}

export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(ip: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.failures.get(ip) ?? []).filter((t) => t > cutoff);
    if (kept.length > 0) this.failures.set(ip, kept);
    else this.failures.delete(ip);
    return kept;
  }

  /** Call before verifying the PIN. */
  check(ip: string): ThrottleDecision {
    const recent = this.recent(ip);
    if (recent.length >= this.max) {
      const oldest = recent[0] ?? this.now();
      return { allowed: false, retryAfterMs: Math.max(oldest + this.windowMs - this.now(), 0), delayMs: 0 };
    }
    return { allowed: true, retryAfterMs: 0, delayMs: Math.min(recent.length * 400, 2000) };
  }

  /** Record a failed attempt. */
  fail(ip: string): void {
    const recent = this.recent(ip);
    recent.push(this.now());
    this.failures.set(ip, recent);
  }

  /** Clear the ip's history after a successful login. */
  succeed(ip: string): void {
    this.failures.delete(ip);
  }
}
