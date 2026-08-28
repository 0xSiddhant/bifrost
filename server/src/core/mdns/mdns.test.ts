import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { Bonjour } from 'bonjour-service';
import { attachResponderGuards, mdnsErrorHandler } from './index.js';

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
