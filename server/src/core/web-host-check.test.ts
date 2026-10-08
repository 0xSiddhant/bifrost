import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkWebHostLater, webHostProbeUrl } from './web-host-check.js';

/** PLAN-36 upgrade safety: the API says so when nothing serves PORT. */
afterEach(() => {
  vi.useRealTimers();
});

function spyLog() {
  const log = pino({ level: 'silent' });
  return { log, error: vi.spyOn(log, 'error'), debug: vi.spyOn(log, 'debug') };
}

describe('the web host check', () => {
  it('probes an all-interfaces bind on loopback, and a specific bind where it is', () => {
    expect(webHostProbeUrl('0.0.0.0', 4646)).toBe('http://127.0.0.1:4646/healthz');
    expect(webHostProbeUrl('127.0.0.1', 4646)).toBe('http://127.0.0.1:4646/healthz');
    expect(webHostProbeUrl('::1', 4646)).toBe('http://[::1]:4646/healthz');
  });

  it('logs an error naming the fix when nothing answers after the grace period', async () => {
    vi.useFakeTimers();
    const { log, error } = spyLog();
    const probe = vi.fn(async () => false);
    checkWebHostLater({ port: 4646, webHost: '0.0.0.0', log, graceMs: 10_000, probe });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:4646/healthz');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ port: 4646 }),
      expect.stringMatching(/nothing is serving PORT 4646.*start-pm2\.sh.*start-launchd\.sh/),
    );
  });

  it('stays quiet when the web host answers', async () => {
    vi.useFakeTimers();
    const { log, error } = spyLog();
    checkWebHostLater({ port: 4646, webHost: '0.0.0.0', log, graceMs: 10, probe: async () => true });
    await vi.advanceTimersByTimeAsync(10);
    expect(error).not.toHaveBeenCalled();
  });

  it('can be cancelled, so a quick shutdown never reports a false alarm', async () => {
    vi.useFakeTimers();
    const { log } = spyLog();
    const probe = vi.fn(async () => false);
    const cancel = checkWebHostLater({ port: 4646, webHost: '0.0.0.0', log, graceMs: 10, probe });
    cancel();
    await vi.advanceTimersByTimeAsync(20);
    expect(probe).not.toHaveBeenCalled();
  });
});
