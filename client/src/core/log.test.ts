import { describe, expect, it } from 'vitest';
import { ClientLogger } from './log';

/** A transport with hand-driven time, so no test waits on a real timer. */
function harness(options: { failSends?: boolean } = {}) {
  const sent: unknown[][] = [];
  let pending: (() => void) | null = null;
  const logger = new ClientLogger({
    send: async (entries) => {
      sent.push(entries);
      if (options.failSends) throw new Error('endpoint refused');
      await Promise.resolve();
    },
    now: () => 1_700_000_000_000,
    route: () => '/accio',
    schedule: (fn) => {
      pending = fn;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  });
  return {
    logger,
    sent,
    /** Fire the debounce timer and let the send settle. */
    tick: async () => {
      const fn = pending;
      pending = null;
      fn?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    isScheduled: () => pending !== null,
  };
}

describe('ClientLogger', () => {
  it('sends warn and above at the default floor', async () => {
    const h = harness();
    h.logger.warn('slow save', { module: 'accio' });
    h.logger.error('save failed', { module: 'accio' });
    await h.tick();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toHaveLength(2);
  });

  // Criterion 15b: at the default floor these cost nothing on the wire.
  it('sends nothing for debug/info/trace at the default floor', async () => {
    const h = harness();
    h.logger.trace('x');
    h.logger.debug('y');
    h.logger.info('z');
    expect(h.isScheduled()).toBe(false);
    await h.tick();
    expect(h.sent).toHaveLength(0);
  });

  it('starts sending debug once the server lowers the floor — no rebuild', async () => {
    const h = harness();
    await h.logger.configure(() => Promise.resolve({ level: 'debug', maxBatch: 50 }));
    expect(h.logger.floor).toBe('debug');
    h.logger.debug('now interesting', { module: 'loki' });
    await h.tick();
    expect(h.sent).toHaveLength(1);
  });

  // Criterion 15b: logging must not depend on the config round-trip.
  it('keeps the warn floor when the config request fails', async () => {
    const h = harness();
    await h.logger.configure(() => Promise.reject(new Error('offline')));
    expect(h.logger.floor).toBe('warn');
    h.logger.error('still reported');
    await h.tick();
    expect(h.sent).toHaveLength(1);
  });

  it('batches a burst into one request', async () => {
    const h = harness();
    for (let i = 0; i < 5; i += 1) h.logger.error(`boom ${i}`);
    await h.tick();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toHaveLength(5);
  });

  it('stamps each entry with the route and the browser clock', async () => {
    const h = harness();
    h.logger.error('render error', { module: 'accio', stack: 'at X' });
    await h.tick();
    expect(h.sent[0]?.[0]).toMatchObject({
      level: 'error',
      msg: 'render error',
      module: 'accio',
      route: '/accio',
      stack: 'at X',
      ts: 1_700_000_000_000,
    });
  });

  it('trims an oversized message rather than letting the server reject the batch', async () => {
    const h = harness();
    h.logger.error('x'.repeat(5000));
    await h.tick();
    const entry = h.sent[0]?.[0] as { msg: string };
    expect(entry.msg).toHaveLength(2000);
  });

  // The important one: a retry against a refusing endpoint would grow both the
  // queue and the request rate exactly when the page is already in trouble.
  it('drops a failed batch instead of retrying it', async () => {
    const h = harness({ failSends: true });
    h.logger.error('first');
    await h.tick();
    expect(h.sent).toHaveLength(1);

    h.logger.error('second');
    await h.tick();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toHaveLength(1);
    expect((h.sent[1]?.[0] as { msg: string }).msg).toBe('second');
  });

  it('stops queueing once a page floods, so one bad loop cannot grow forever', async () => {
    const h = harness();
    for (let i = 0; i < 500; i += 1) h.logger.error(`loop ${i}`);
    await h.tick();
    const total = h.sent.reduce((sum, batch) => sum + batch.length, 0);
    expect(total).toBeLessThanOrEqual(100);
  });

  it('reportError unwraps an Error into message + stack', async () => {
    const h = harness();
    const error = new Error('network down');
    h.logger.reportError('device registry failed', error, { module: 'presence' });
    await h.tick();
    const entry = h.sent[0]?.[0] as { msg: string; stack?: string };
    expect(entry.msg).toBe('device registry failed: network down');
    expect(entry.stack).toContain('Error: network down');
  });

  it('never throws out of a report or a flush, whatever the transport does', async () => {
    const h = harness({ failSends: true });
    expect(() => h.logger.error('boom')).not.toThrow();
    await expect(h.logger.flush()).resolves.toBeUndefined();
  });
});
