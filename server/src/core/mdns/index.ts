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
 * and the process keeps running.
 */
export function mdnsErrorHandler(log: Logger): (error: unknown) => void {
  return (error: unknown) => {
    log.warn({ err: error }, 'mdns responder error — advertisement degraded, http unaffected');
  };
}

type Responder = { on(event: string, listener: (error: unknown) => void): unknown };

/**
 * Second guard, for the errors the callback above never sees: the responder's
 * own EventEmitter, whose unhandled `'error'` event throws (bind failures —
 * EACCES, or another responder already holding 5353).
 *
 * Reaching for the socket is deliberate and guarded. It is a private field, so
 * a future version of the library may rename it; if that happens we lose this
 * second guard and keep the first, rather than failing to start.
 */
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

/** How often to look for an interface coming or going. `os` reads, not I/O. */
const NETWORK_POLL_MS = 5_000;
/** A goodbye packet on a dead interface must not wedge the rebuild behind it. */
const TEARDOWN_TIMEOUT_MS = 2_000;

/** The LAN's identity, as a value that can be compared between polls. */
export const networkSignature = (addresses: string[]): string => [...addresses].sort().join(',');

export interface NetworkWatchOptions {
  addresses: () => string[];
  onChange: (from: string, to: string) => Promise<void> | void;
  pollMs?: number;
  log: Logger;
}

/**
 * Call `onChange` whenever the set of LAN addresses changes.
 *
 * This exists because `multicast-dns` cannot recover from an interface that
 * leaves and comes back on the *same* address. Its `update()` loop skips any
 * address already in its `memberships` map — a map only ever cleared on
 * `destroy()` — while the OS silently drops the group membership when the
 * interface goes down. So the socket stays joined in bookkeeping and deaf in
 * fact, and the responder answers nothing until the process restarts. A new
 * DHCP lease recovers by itself, an unchanged address never does, which is why
 * coming back to the same network looks like it "takes forever".
 *
 * Rebuilding the responder on any change fixes both directions and re-announces
 * the service, so other devices' caches refresh instead of ageing out.
 */
export function watchNetworkChanges(options: NetworkWatchOptions): () => void {
  const { addresses, onChange, pollMs = NETWORK_POLL_MS, log } = options;
  let current = networkSignature(addresses());
  let busy = false;

  const tick = async (): Promise<void> => {
    // A rebuild outlasting a poll must not start a second one on top of it.
    if (busy) return;
    const next = networkSignature(addresses());
    if (next === current) return;
    busy = true;
    const from = current;
    current = next;
    try {
      await onChange(from, next);
    } catch (error) {
      log.warn({ err: error, from, to: next }, 'mdns re-advertise failed after a network change');
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), pollMs);
  // Never a reason to hold the process open.
  timer.unref();
  return () => clearInterval(timer);
}

export interface AdvertiseOptions {
  /** Test seam: where the LAN addresses come from, and how often to look. */
  addresses?: () => string[];
  pollMs?: number;
}

/** Advertise the hub over Bonjour so Apple devices resolve http://<name>.local. */
export function advertiseMdns(
  name: string,
  port: number,
  log: Logger,
  options: AdvertiseOptions = {},
): MdnsHandle {
  let responder: InstanceType<typeof Bonjour> | null = null;

  const publish = (): void => {
    // The second argument replaces bonjour-service's `throw err` default — see
    // mdnsErrorHandler. Without it a send failure is a fatal, not a warning.
    const bonjour = new Bonjour(undefined, mdnsErrorHandler(log));
    attachResponderGuards(bonjour, log);
    // host is what makes the responder answer A/AAAA queries for <name>.local —
    // advertising the service alone only registers PTR/SRV/TXT, and the browser
    // resolves the hostname, not the service.
    bonjour.publish({ name, type: 'http', port, host: `${name}.local` });
    responder = bonjour;
    log.info({ name: `${name}.local`, port }, 'mdns advertisement up');
  };

  const teardown = async (bonjour: InstanceType<typeof Bonjour>): Promise<void> => {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      new Promise<void>((resolve) => {
        bonjour.unpublishAll(() => {
          bonjour.destroy();
          resolve();
        });
      }),
      // The goodbye packets go out over the interface that just disappeared, so
      // "did they send" is not a question worth blocking a rebuild on.
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TEARDOWN_TIMEOUT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
  };

  publish();

  const stopWatching = watchNetworkChanges({
    addresses: options.addresses ?? lanIPv4Addresses,
    pollMs: options.pollMs,
    log,
    onChange: async (from, to) => {
      log.info({ from, to }, 'network changed — rebuilding mdns advertisement');
      const previous = responder;
      responder = null;
      if (previous) await teardown(previous);
      publish();
    },
  });

  return {
    stop: async () => {
      stopWatching();
      const previous = responder;
      responder = null;
      if (previous) await teardown(previous);
    },
  };
}
