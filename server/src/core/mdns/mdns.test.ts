import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { Bonjour } from 'bonjour-service';
import {
  advertiseMdns,
  attachResponderGuards,
  mdnsErrorHandler,
  networkSignature,
  watchNetworkChanges,
} from './index.js';

const silent = () => pino({ level: 'silent' });

describe('mdnsErrorHandler', () => {
  it('never throws — the whole point, since it runs in a dgram send callback', () => {
    const handler = mdnsErrorHandler(silent());
    const sendFailure = Object.assign(new Error('send EADDRNOTAVAIL 224.0.0.251:5353'), {
      errno: -49,
      code: 'EADDRNOTAVAIL',
      syscall: 'send',
    });
    expect(() => handler(sendFailure)).not.toThrow();
  });

  it('records the error on a warn line, so a lost advertisement is still visible', () => {
    const log = silent();
    const warn = vi.spyOn(log, 'warn');
    const error = new Error('send EADDRNOTAVAIL 224.0.0.251:5353');
    mdnsErrorHandler(log)(error);

    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, message] = warn.mock.calls[0] as [{ err: unknown }, string];
    expect(fields.err).toBe(error);
    expect(message).toContain('mdns');
  });
});

describe('attachResponderGuards', () => {
  it("listens for the responder's own error event, which would otherwise throw", () => {
    const responder = new EventEmitter();
    expect(attachResponderGuards({ server: { mdns: responder } }, silent())).toBe(true);

    // An EventEmitter with no 'error' listener throws on emit — that is the
    // failure being guarded, so emitting is the assertion.
    expect(() => responder.emit('error', new Error('EADDRINUSE'))).not.toThrow();
    expect(() => responder.emit('warning', new Error('addMembership failed'))).not.toThrow();
  });

  it('degrades to the send-error guard alone if the library moves the socket', () => {
    expect(attachResponderGuards({}, silent())).toBe(false);
    expect(attachResponderGuards({ server: {} }, silent())).toBe(false);
    expect(attachResponderGuards(null, silent())).toBe(false);
  });

  it('finds the socket on a real Bonjour instance', () => {
    // Pins the private-field reach against the installed library: if this ever
    // fails, the second guard has silently stopped attaching.
    const bonjour = new Bonjour(undefined, mdnsErrorHandler(silent()));
    try {
      expect(attachResponderGuards(bonjour, silent())).toBe(true);
    } finally {
      bonjour.destroy();
    }
  });
});

describe('networkSignature', () => {
  it('ignores the order the OS happens to list interfaces in', () => {
    expect(networkSignature(['192.168.1.5', '10.0.0.2'])).toBe(
      networkSignature(['10.0.0.2', '192.168.1.5']),
    );
  });

  it('separates gaining, losing and swapping an address', () => {
    const base = networkSignature(['192.168.1.5']);
    expect(networkSignature(['192.168.1.5', '10.0.0.2'])).not.toBe(base);
    expect(networkSignature([])).not.toBe(base);
    expect(networkSignature(['192.168.1.9'])).not.toBe(base);
  });
});

describe('watchNetworkChanges', () => {
  afterEach(() => vi.useRealTimers());

  const run = (frames: string[][]) => {
    vi.useFakeTimers();
    let frame = 0;
    const changes: [string, string][] = [];
    const stop = watchNetworkChanges({
      addresses: () => frames[Math.min(frame, frames.length - 1)] ?? [],
      onChange: (from, to) => {
        changes.push([from, to]);
      },
      pollMs: 1_000,
      log: pino({ level: 'silent' }),
    });
    return {
      changes,
      stop,
      async advance() {
        frame += 1;
        await vi.advanceTimersByTimeAsync(1_000);
      },
    };
  };

  it('stays quiet while the network is the same', async () => {
    const w = run([['192.168.1.5'], ['192.168.1.5'], ['192.168.1.5']]);
    await w.advance();
    await w.advance();
    expect(w.changes).toEqual([]);
    w.stop();
  });

  it('fires when an interface goes away and again when it returns', async () => {
    const w = run([['192.168.1.5'], [], ['192.168.1.5']]);
    await w.advance();
    await w.advance();
    // The second one is the case multicast-dns cannot recover from on its own:
    // the same address returning, which its membership map makes it skip.
    expect(w.changes).toEqual([
      ['192.168.1.5', ''],
      ['', '192.168.1.5'],
    ]);
    w.stop();
  });

  it('does not start a second rebuild on top of one still running', async () => {
    vi.useFakeTimers();
    let addresses = ['192.168.1.5'];
    let started = 0;
    // Held on an object, not in a local: assigning inside the promise executor
    // is invisible to control-flow analysis, which then narrows a `let` to
    // `never` and refuses the call below.
    const pending = { release: (): void => {} };
    const stop = watchNetworkChanges({
      addresses: () => addresses,
      onChange: () => {
        started += 1;
        return new Promise<void>((resolve) => {
          pending.release = resolve;
        });
      },
      pollMs: 1_000,
      log: pino({ level: 'silent' }),
    });

    addresses = [];
    await vi.advanceTimersByTimeAsync(1_000);
    addresses = ['10.0.0.2'];
    await vi.advanceTimersByTimeAsync(3_000);
    expect(started).toBe(1);

    pending.release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toBe(2);
    stop();
  });

  it('keeps watching after a rebuild throws', async () => {
    vi.useFakeTimers();
    let addresses = ['192.168.1.5'];
    let calls = 0;
    const stop = watchNetworkChanges({
      addresses: () => addresses,
      onChange: () => {
        calls += 1;
        throw new Error('teardown blew up');
      },
      pollMs: 1_000,
      log: pino({ level: 'silent' }),
    });

    addresses = [];
    await vi.advanceTimersByTimeAsync(1_000);
    addresses = ['10.0.0.2'];
    await vi.advanceTimersByTimeAsync(1_000);
    // A failed rebuild must not leave the watcher wedged — the next change is
    // the one that recovers the advertisement.
    expect(calls).toBe(2);
    stop();
  });

  it('stops polling once stopped', async () => {
    vi.useFakeTimers();
    let addresses = ['192.168.1.5'];
    let calls = 0;
    const stop = watchNetworkChanges({
      addresses: () => addresses,
      onChange: () => {
        calls += 1;
      },
      pollMs: 1_000,
      log: pino({ level: 'silent' }),
    });
    stop();
    addresses = [];
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(0);
  });
});

describe('advertiseMdns', () => {
  it('rebuilds the responder when the LAN changes, and stops cleanly', async () => {
    const log = pino({ level: 'silent' });
    const up = vi.spyOn(log, 'info');
    let addresses = ['192.168.1.5'];

    const handle = advertiseMdns('bifrost-test', 4646, log, {
      addresses: () => addresses,
      pollMs: 20,
    });
    const published = () =>
      up.mock.calls.filter((call) => String(call[1]).includes('advertisement up')).length;
    expect(published()).toBe(1);

    // The case multicast-dns cannot recover from on its own: the interface
    // leaves and returns on the same address, so its membership map skips it
    // and the responder stays deaf. A rebuild is what brings it back.
    addresses = [];
    await vi.waitFor(() => expect(published()).toBe(2), { timeout: 4_000 });
    addresses = ['192.168.1.5'];
    await vi.waitFor(() => expect(published()).toBe(3), { timeout: 4_000 });

    await handle.stop();

    // Stopped means stopped: no further rebuilds after the handle is closed.
    addresses = ['10.0.0.9'];
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(published()).toBe(3);
  }, 20_000);
});
