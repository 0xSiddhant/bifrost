import { describe, expect, it } from 'vitest';
import { TestGuard } from './guard.js';

describe('TestGuard (single-flight state machine)', () => {
  it('lets the first device in and turns the second away', () => {
    const guard = new TestGuard(5_000);
    expect(guard.acquire('phone', 1_000)).toEqual({ ok: true });
    expect(guard.acquire('ipad', 1_100)).toEqual({ ok: false, holder: 'phone' });
  });

  it('lets the holder run its remaining phases', () => {
    const guard = new TestGuard(5_000);
    guard.acquire('phone', 0);
    guard.finish('phone', 100);
    // Same device, next phase (down → up) — still inside the grace window.
    expect(guard.acquire('phone', 200)).toEqual({ ok: true });
    expect(guard.acquire('ipad', 250)).toEqual({ ok: false, holder: 'phone' });
  });

  it('frees itself after the grace window when a client vanishes', () => {
    const guard = new TestGuard(5_000);
    guard.acquire('phone', 0);
    guard.finish('phone', 1_000); // laptop lid closes here
    expect(guard.holder(2_000)).toBe('phone');
    expect(guard.acquire('ipad', 5_999)).toEqual({ ok: false, holder: 'phone' });
    expect(guard.holder(6_001)).toBeNull();
    expect(guard.acquire('ipad', 6_001)).toEqual({ ok: true });
  });

  it('does not expire while a request is still in flight', () => {
    const guard = new TestGuard(5_000);
    guard.acquire('phone', 0);
    // A 100 MB download can easily outlast the grace window; only the *end* of
    // the last request starts the countdown.
    expect(guard.holder(1_000_000)).toBe('phone');
  });

  it('counts overlapping requests from the holder', () => {
    const guard = new TestGuard(5_000);
    guard.acquire('phone', 0);
    guard.acquire('phone', 10);
    guard.finish('phone', 20);
    // One request ended, one is still running — no grace window yet.
    expect(guard.holder(1_000_000)).toBe('phone');
    guard.finish('phone', 1_000_001);
    expect(guard.holder(1_000_002)).toBe('phone');
    expect(guard.holder(1_005_002)).toBeNull();
  });

  it('releases immediately when the client says it is done', () => {
    const guard = new TestGuard(5_000);
    guard.acquire('phone', 0);
    guard.finish('phone', 100);
    expect(guard.release('phone')).toBe(true);
    // No grace wait: the next device starts right away (cancel case).
    expect(guard.acquire('ipad', 101)).toEqual({ ok: true });
  });

  it('ignores release and finish from a device that holds nothing', () => {
    const guard = new TestGuard(5_000);
    guard.acquire('phone', 0);
    expect(guard.release('ipad')).toBe(false);
    guard.finish('ipad', 10);
    expect(guard.holder(10)).toBe('phone');
    // The holder's own lease survived the stranger's calls intact.
    expect(guard.acquire('ipad', 20)).toEqual({ ok: false, holder: 'phone' });
  });

  it('reports state for the config endpoint', () => {
    const guard = new TestGuard(5_000);
    expect(guard.state(0)).toEqual({ busy: false, holder: null, since: null });
    guard.acquire('phone', 42);
    expect(guard.state(50)).toEqual({ busy: true, holder: 'phone', since: 42 });
  });
});
