import type { Logger } from './logger/index.js';

/**
 * Upgrade safety (PLAN-36): an install from before the split runs ONE process
 * definition (PM2 app, launchd plist, compose service) that starts this
 * server. After the upgrade that same definition starts only the API, on
 * loopback, and nothing answers PORT, so every device loses the hub with no
 * sign of why. So in `full` mode the API looks for the web host once, after a
 * grace period, and says loudly what to do if it is not there.
 */

/** Long enough for the web host to start beside it under any launcher. */
export const WEB_HOST_GRACE_MS = 10_000;

export interface WebHostCheckOptions {
  port: number;
  /** Where the web host listens; an all-interfaces bind is probed on loopback. */
  webHost: string;
  log: Logger;
  graceMs?: number;
  /** Test seam. */
  probe?: (url: string) => Promise<boolean>;
}

export function webHostProbeUrl(webHost: string, port: number): string {
  const host = webHost === '0.0.0.0' || webHost === '::' ? '127.0.0.1' : webHost;
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}/healthz`;
}

async function httpProbe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    // Deliberately silent: "nothing answered" is the answer this asks for.
    return false;
  }
}

/** Check once after the grace period; returns a cancel for shutdown. */
export function checkWebHostLater(options: WebHostCheckOptions): () => void {
  const { port, webHost, log, graceMs = WEB_HOST_GRACE_MS, probe = httpProbe } = options;
  const url = webHostProbeUrl(webHost, port);
  const timer = setTimeout(() => {
    void probe(url).then((ok) => {
      if (ok) {
        log.debug({ url }, 'web host answering on PORT');
        return;
      }
      log.error(
        { port, url },
        `nothing is serving PORT ${port} — the web host is not running; ` +
          're-run `sh scripts/start-pm2.sh` or `sh scripts/start-launchd.sh`',
      );
    });
  }, graceMs);
  timer.unref();
  return () => clearTimeout(timer);
}
