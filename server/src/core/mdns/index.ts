import os from 'node:os';
import { Bonjour } from 'bonjour-service';
import type { Logger } from '../logger/index.js';

export interface MdnsHandle {
  stop(): Promise<void>;
}

export function lanIPv4Addresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => (iface as os.NetworkInterfaceInfo).address);
}

/**
 * What to do when the responder cannot reach the multicast group.
 *
 * bonjour-service's default error callback is literally `throw err`, and it is
 * invoked from a dgram *send* callback — an async context with no caller to
 * catch it, so the throw lands on `uncaughtException` and the fatal handler
 * takes the whole hub down. The commonest trigger is the most ordinary event a
 * laptop has: the Wi-Fi it was advertising on goes away, the interface loses
 * its address, and the next answer to a `.local` query fails with
 * `EADDRNOTAVAIL 224.0.0.251:5353`.
 *
 * Bifrost is an HTTP server that also advertises itself. Losing the
 * advertisement costs `bifrost.local`; every LAN IP still serves. Killing the
 * process over it costs everything — including, since PLAN-22, the warmed tabs
 * that were the whole point of surviving a network drop. So this is a `warn`
 * and the process keeps running: `multicast-dns` re-joins the group on its own
 * 5s interval, so the advertisement comes back by itself when the interface
 * does.
 */
export function mdnsErrorHandler(log: Logger): (error: unknown) => void {
  return (error: unknown) => {
    log.warn({ err: error }, 'mdns responder error — advertisement degraded, http unaffected');
  };
}

/**
 * Second guard, for the errors the callback above never sees: the responder's
 * own EventEmitter, whose unhandled `'error'` event throws (bind failures —
 * EACCES, or another responder already holding 5353).
 *
 * Reaching for the socket is deliberate and guarded. It is a private field, so
 * a future version of the library may rename it; if that happens we lose this
 * second guard and keep the first, rather than failing to start.
 */
type Responder = { on(event: string, listener: (error: unknown) => void): unknown };

export function attachResponderGuards(bonjour: unknown, log: Logger): boolean {
  const responder =
    typeof bonjour === 'object' && bonjour !== null
      ? (bonjour as { server?: { mdns?: Partial<Responder> } }).server?.mdns
      : undefined;
  if (!responder || typeof responder.on !== 'function') {
    log.debug('mdns responder socket not reachable — send-error guard only');
    return false;
  }
  // Called as a method, not through a lifted reference: `on` is EventEmitter's
  // own, and an unbound call loses `this` and throws on `_events`.
  const emitter = responder as Responder;
  emitter.on('error', mdnsErrorHandler(log));
  // 'warning' carries the per-interface addMembership failures the library
  // already swallows; with no listener they are silent, which is how a
  // half-joined responder looks exactly like a working one.
  emitter.on('warning', (error: unknown) => log.debug({ err: error }, 'mdns responder warning'));
  return true;
}

/** Advertise the hub over Bonjour so Apple devices resolve http://<name>.local. */
export function advertiseMdns(name: string, port: number, log: Logger): MdnsHandle {
  // The second argument replaces bonjour-service's `throw err` default — see
  // mdnsErrorHandler. Without it a send failure is a fatal, not a warning.
  const bonjour = new Bonjour(undefined, mdnsErrorHandler(log));
  attachResponderGuards(bonjour, log);

  // host is what makes the responder answer A/AAAA queries for <name>.local —
  // advertising the service alone only registers PTR/SRV/TXT, and the browser
  // resolves the hostname, not the service.
  bonjour.publish({ name, type: 'http', port, host: `${name}.local` });
  log.info({ name: `${name}.local`, port }, 'mdns advertisement up');
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        bonjour.unpublishAll(() => {
          bonjour.destroy();
          resolve();
        });
      }),
  };
}
