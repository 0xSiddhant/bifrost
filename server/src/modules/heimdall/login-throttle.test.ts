import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './login-throttle.js';

describe('LoginThrottle', () => {
  it('allows attempts until the max, then locks out', () => {
    const clock = 0;
    const throttle = new LoginThrottle(5, 1000, () => clock);
    for (let i = 0; i < 5; i += 1) {
      expect(throttle.check('1.2.3.4').allowed).toBe(true);
      throttle.fail('1.2.3.4');
    }
    const blocked = throttle.check('1.2.3.4');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('adds an incremental delay as failures accumulate', () => {
    const clock = 0;
    const throttle = new LoginThrottle(5, 10_000, () => clock);
    expect(throttle.check('ip').delayMs).toBe(0);
    throttle.fail('ip');
    expect(throttle.check('ip').delayMs).toBe(400);
    throttle.fail('ip');
    expect(throttle.check('ip').delayMs).toBe(800);
  });

  it('frees up once the window slides past the failures', () => {
    let clock = 0;
    const throttle = new LoginThrottle(2, 1000, () => clock);
    throttle.fail('ip');
    throttle.fail('ip');
    expect(throttle.check('ip').allowed).toBe(false);
    clock = 1001;
    expect(throttle.check('ip').allowed).toBe(true);
  });

  it('isolates ips and clears history on success', () => {
    const clock = 0;
    const throttle = new LoginThrottle(1, 1000, () => clock);
    throttle.fail('a');
    expect(throttle.check('a').allowed).toBe(false);
    expect(throttle.check('b').allowed).toBe(true);
    throttle.succeed('a');
    expect(throttle.check('a').allowed).toBe(true);
  });
});
