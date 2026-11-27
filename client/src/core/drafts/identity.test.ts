import { describe, expect, it } from 'vitest';
import {
  HANDSHAKE_MS,
  TAB_ID_KEY,
  TabIdentity,
  type ChannelLike,
  type IdentityEvent,
} from './identity';
import { memoryStorage } from './storage';

/** A BroadcastChannel stand-in: every channel on the bus hears every other one, asynchronously. */
function bus() {
  const channels = new Set<ChannelLike>();
  const pending: (() => void)[] = [];
  return {
    open(): ChannelLike {
      const channel: ChannelLike = {
        onmessage: null,
        postMessage: (data: unknown) => {
          for (const other of channels) {
            if (other !== channel) pending.push(() => other.onmessage?.({ data }));
          }
        },
        close: () => channels.delete(channel),
      };
      channels.add(channel);
      return channel;
    },
    /** Deliver queued messages (and those their handlers send), in order. */
    deliver() {
      while (pending.length > 0) pending.shift()?.();
    },
  };
}

/** Manual timers. */
function timers() {
  const queue: { at: number; fn: () => void }[] = [];
  let now = 0;
  return {
    set: (fn: () => void, ms: number) => {
      queue.push({ at: now + ms, fn });
    },
    advance(ms: number) {
      now += ms;
      for (const timer of queue.filter((entry) => entry.at <= now)) {
        queue.splice(queue.indexOf(timer), 1);
        timer.fn();
      }
    },
  };
}

let counter = 0;
const nextId = () => `id${(counter += 1).toString().padStart(3, '0')}`;

function tab(
  session: ReturnType<typeof memoryStorage>,
  net: ReturnType<typeof bus> | null,
  clock: ReturnType<typeof timers>,
) {
  const events: IdentityEvent[] = [];
  const identity = new TabIdentity({
    session,
    openChannel: () => (net ? net.open() : null),
    newId: nextId,
    setTimer: clock.set,
  });
  identity.on((event) => events.push(event));
  return { identity, events };
}

describe('TabIdentity (PLAN-43)', () => {
  it('takes a fresh id straight away when the tab has none', () => {
    const clock = timers();
    const session = memoryStorage();
    const { identity, events } = tab(session, bus(), clock);
    identity.start();
    expect(identity.ready).toBe(true);
    expect(identity.origin).toBe('fresh');
    expect(session.get(TAB_ID_KEY)).toBe(identity.tab);
    expect(events).toEqual(['ready']);
  });

  it('keeps its id across a reload once nobody answers for it', () => {
    const clock = timers();
    const net = bus();
    const session = memoryStorage({ [TAB_ID_KEY]: 'tab-kept' });
    const { identity } = tab(session, net, clock);
    identity.start();
    expect(identity.ready).toBe(false);
    net.deliver();
    clock.advance(HANDSHAKE_MS);
    expect(identity.ready).toBe(true);
    expect(identity.tab).toBe('tab-kept');
    expect(identity.origin).toBe('reused');
  });

  it('gives a duplicated tab a new id, and leaves the original its own', () => {
    const clock = timers();
    const net = bus();
    const original = tab(memoryStorage(), net, clock);
    original.identity.start();
    const copied = memoryStorage({ [TAB_ID_KEY]: original.identity.tab });
    const duplicate = tab(copied, net, clock);
    duplicate.identity.start();
    net.deliver();
    expect(duplicate.identity.ready).toBe(true);
    expect(duplicate.identity.origin).toBe('yielded');
    expect(duplicate.identity.tab).not.toBe(original.identity.tab);
    expect(copied.get(TAB_ID_KEY)).toBe(duplicate.identity.tab);
    // The original rewrites its own drafts in case its twin wrote first.
    clock.advance(1000);
    expect(original.events).toEqual(['ready', 'reflush']);
    expect(original.identity.tab).not.toBe(duplicate.identity.tab);
  });

  it('moves a tab that was already writing when a late answer arrives', () => {
    const clock = timers();
    const net = bus();
    const original = tab(memoryStorage(), net, clock);
    original.identity.start();
    const duplicate = tab(memoryStorage({ [TAB_ID_KEY]: original.identity.tab }), net, clock);
    duplicate.identity.start();
    // The original was busy: the duplicate's wait runs out first.
    clock.advance(HANDSHAKE_MS);
    expect(duplicate.identity.tab).toBe(original.identity.tab);
    net.deliver();
    expect(duplicate.identity.tab).not.toBe(original.identity.tab);
    expect(duplicate.events).toEqual(['ready', 'changed']);
  });

  it('settles two copies still asking at once: exactly one yields', () => {
    const clock = timers();
    const net = bus();
    const first = tab(memoryStorage({ [TAB_ID_KEY]: 'shared' }), net, clock);
    const second = tab(memoryStorage({ [TAB_ID_KEY]: 'shared' }), net, clock);
    first.identity.start();
    second.identity.start();
    net.deliver();
    clock.advance(HANDSHAKE_MS);
    const kept = [first, second].filter(({ identity }) => identity.tab === 'shared');
    expect(kept).toHaveLength(1);
  });

  it('keeps its id across a reload even if the page it replaces can still hear it', () => {
    const clock = timers();
    const net = bus();
    const session = memoryStorage();
    const before = tab(session, net, clock);
    before.identity.start();
    // The old document has fired pagehide, but WebKit may still deliver to it.
    before.identity.suspend();
    const after = tab(session, net, clock);
    after.identity.start();
    net.deliver();
    clock.advance(HANDSHAKE_MS);
    expect(after.identity.tab).toBe(before.identity.tab);
    expect(after.identity.origin).toBe('reused');
  });

  it('answers for its id again when it comes back from the back/forward cache', () => {
    const clock = timers();
    const net = bus();
    const cached = tab(memoryStorage(), net, clock);
    cached.identity.start();
    cached.identity.suspend();
    cached.identity.resume();
    const twin = tab(memoryStorage({ [TAB_ID_KEY]: cached.identity.tab }), net, clock);
    twin.identity.start();
    net.deliver();
    expect(twin.identity.tab).not.toBe(cached.identity.tab);
  });

  it('never reuses a stored id without a channel to check it', () => {
    const clock = timers();
    const { identity } = tab(memoryStorage({ [TAB_ID_KEY]: 'maybe-copied' }), null, clock);
    identity.start();
    expect(identity.ready).toBe(true);
    expect(identity.origin).toBe('no-channel');
    expect(identity.tab).not.toBe('maybe-copied');
  });

  it('works without sessionStorage, at the cost of a new id per load', () => {
    const clock = timers();
    const blocked = memoryStorage();
    blocked.failWrites = new DOMException('blocked', 'SecurityError');
    const { identity } = tab(blocked, bus(), clock);
    identity.start();
    expect(identity.ready).toBe(true);
    expect(identity.tab).not.toBe('');
  });
});
