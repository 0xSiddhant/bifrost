// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryBackend } from './coordinator';
import { OFFER_GRACE_MS, PRUNE_GRACE_MS, findOffer } from './protocol';
import { SCRATCH, leftKey, makeEnvelope, parseDeparture, recordKey } from './records';
import { createTestSession } from './testing';
import { memoryStorage } from './storage';
import { textDraftCodec } from './documents';
import type { DraftSession } from './session';

describe('DraftSession (PLAN-43)', () => {
  const sessions: DraftSession[] = [];
  afterEach(() => {
    for (const session of sessions.splice(0)) session.stop();
    localStorage.clear();
  });

  const start = (overrides: Parameters<typeof createTestSession>[0] = {}) => {
    const session = createTestSession(overrides);
    sessions.push(session);
    session.start();
    return session;
  };

  it('flushes every editor, then records leaving, when the page is unloaded', () => {
    const session = start();
    const me = session.me();
    if (!me) throw new Error('not ready');
    const order: string[] = [];
    session.registerFlusher(() => {
      order.push('flush');
      expect(localStorage.getItem(leftKey(me.tab))).toBeNull();
    });
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    order.push('after');
    expect(order).toEqual(['flush', 'after']);
    expect(parseDeparture(localStorage.getItem(leftKey(me.tab)))).toMatchObject({
      instance: session.identity.instance,
    });
  });

  it('flushes without recording a departure for the back/forward cache or a hidden tab', () => {
    const session = start();
    const me = session.me();
    if (!me) throw new Error('not ready');
    const flushes = vi.fn();
    session.registerFlusher(flushes);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(flushes).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(leftKey(me.tab))).toBeNull();
  });

  it('clears its own earlier departure the moment it is back, even with no IndexedDB', async () => {
    vi.useFakeTimers();
    try {
      const tabStore = memoryStorage({ 'bifrost.tab.id': 'tab-back' });
      localStorage.setItem(leftKey('tab-back'), JSON.stringify({ instance: 'old', at: 1 }));
      // A channel nobody answers on: the reload keeps its id after the wait.
      const quiet = { onmessage: null, postMessage: () => undefined, close: () => undefined };
      const reloaded = start({ session: tabStore, backend: null, openChannel: () => quiet });
      expect(reloaded.ready).toBe(false);
      vi.advanceTimersByTime(300);
      expect(reloaded.me()?.tab).toBe('tab-back');
      expect(localStorage.getItem(leftKey('tab-back'))).toBeNull();
      expect(await reloaded.coordinated()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a departed tab’s prune sweep when a quick sweep is asked for meanwhile, and the reverse', async () => {
    vi.useFakeTimers();
    try {
      let clock = 1_000_000;
      const session = start({ now: () => clock });
      const sweeps = vi.spyOn(session, 'sweepNow').mockResolvedValue(0);
      // Another tab left: a sweep once its draft can be pruned...
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: leftKey('tab-gone'),
          newValue: '{"instance":"x","at":1}',
        }),
      );
      // ...then this tab writes its first draft: a sweep shortly after.
      session.requestSweep();
      clock += 2_000;
      vi.advanceTimersByTime(2_000);
      expect(sweeps).toHaveBeenCalledTimes(1);
      // The prune sweep still runs when its grace is over.
      clock += PRUNE_GRACE_MS;
      vi.advanceTimersByTime(PRUNE_GRACE_MS);
      expect(sweeps).toHaveBeenCalledTimes(2);
      // And a quick request is not pushed out by a pending prune.
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: leftKey('tab-gone-2'),
          newValue: '{"instance":"y","at":2}',
        }),
      );
      session.requestSweep();
      vi.advanceTimersByTime(2_000);
      expect(sweeps).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never drops or brings forward a requested sweep, over random request schedules', async () => {
    // Manual time: every timer the session arms is ours to fire in order.
    for (let seed = 1; seed <= 200; seed += 1) {
      let state = seed;
      const random = () => {
        state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
        return state / 4294967296;
      };
      let clock = 0;
      let nextId = 0;
      const timers = new Map<number, { at: number; fn: () => void }>();
      const session = start({
        now: () => clock,
        target: null,
        doc: null,
        setTimer: (fn, ms) => {
          nextId += 1;
          timers.set(nextId, { at: clock + ms, fn });
          return nextId;
        },
        clearTimer: (handle) => timers.delete(handle as number),
      });
      const sweeps: number[] = [];
      vi.spyOn(session, 'sweepNow').mockImplementation(async () => {
        sweeps.push(clock);
        return 0;
      });
      const advance = (to: number) => {
        for (;;) {
          const due = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
          if (!due || due[1].at > to) break;
          timers.delete(due[0]);
          clock = due[1].at;
          due[1].fn();
        }
        clock = to;
      };
      const requests: { at: number; delay: number }[] = [];
      for (let i = 0; i < 30; i += 1) {
        advance(clock + Math.floor(random() * 5_000));
        const delay = random() < 0.5 ? 2_000 : PRUNE_GRACE_MS + 1_000;
        requests.push({ at: clock, delay });
        session.requestSweep(delay);
      }
      advance(clock + PRUNE_GRACE_MS * 3);
      for (const request of requests) {
        const due = request.at + request.delay;
        // A sweep runs once the request is due (a departed tab's draft is
        // prunable only then): one that ran only before would leave it.
        if (!sweeps.some((at) => at >= due))
          throw new Error(
            `seed ${seed}: no sweep for a request at ${request.at} (+${request.delay})`,
          );
      }
      session.stop();
    }
  });

  it('asks again whether a twin holds its id when it wakes or becomes visible', () => {
    const sent: unknown[] = [];
    const channel = {
      onmessage: null,
      postMessage: (m: unknown) => sent.push(m),
      close: () => undefined,
    };
    const session = start({ openChannel: () => channel });
    expect(session.ready).toBe(true);
    sent.length = 0;
    document.dispatchEvent(new Event('resume'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toEqual([
      expect.objectContaining({ t: 'probe', tab: session.me()?.tab }),
      expect.objectContaining({ t: 'probe', tab: session.me()?.tab }),
    ]);
  });

  it('makes a closed tab’s draft offerable to another tab once registered and departed', async () => {
    let clock = 5_000_000;
    const backend = memoryBackend();
    const closing = start({ backend, now: () => clock });
    const other = start({ backend, now: () => clock, target: null, doc: null });
    const closingMe = closing.me();
    const otherMe = other.me();
    if (!closingMe || !otherMe) throw new Error('not ready');
    await closing.coordinated();
    await other.coordinated();
    localStorage.setItem(
      recordKey('runestone', closingMe.tab, SCRATCH),
      JSON.stringify(
        makeEnvelope(
          { feature: 'runestone', tab: closingMe.tab, workspace: SCRATCH },
          { title: 't', text: 'left behind', baseline: null },
          clock,
        ),
      ),
    );
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    clock += OFFER_GRACE_MS;
    const ctx = await other.coordinated();
    if (!ctx) throw new Error('no coordination');
    const found = await findOffer(ctx, otherMe, 'runestone', SCRATCH, textDraftCodec, () => true);
    expect(found.offer?.envelope.payload.text).toBe('left behind');
  });
});
