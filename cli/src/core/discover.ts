import { CliError, EXIT } from './output.js';

/**
 * Where the bridge is.
 *
 * v1 relies on the OS's own `.local` resolution rather than browsing
 * `_http._tcp` itself: `dns.lookup()` goes through `getaddrinfo()`, which on
 * macOS is mDNS-aware via mDNSResponder — the same reason a browser reaches
 * `bifrost.local` with no special handling. That assumption does NOT hold
 * everywhere (Linux needs `nss-mdns` configured, Windows needs Bonjour
 * installed), so every failure to reach the default host is answered with the
 * specific fix rather than a raw DNS error — see `unreachableMessage`, which is
 * the one wording `client.ts` and `doctor` both use.
 */

export const DEFAULT_HOST = 'bifrost.local';
/** Matches the server's own PORT default (server/src/core/config). */
export const DEFAULT_PORT = 4646;
export const DEFAULT_BASE_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

/**
 * Accepts what a person actually types — `bifrost.local`, `192.168.1.20`,
 * `10.0.0.5:8080`, `http://bifrost.local:4646` — and returns an origin with no
 * trailing slash. A bare host gets `http://` and the default port, because a
 * LAN hub on port 80 is the exception and typing the port is how you say so.
 */
export function normalizeHost(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new CliError('host is empty');

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CliError(`"${raw}" is not a usable host — try --host 192.168.1.20:${DEFAULT_PORT}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CliError(`"${raw}" is not an http(s) address`);
  }
  if (url.hostname.length === 0) {
    throw new CliError(`"${raw}" names no host`);
  }
  if (url.port === '' && url.protocol === 'http:') url.port = String(DEFAULT_PORT);
  return `${url.protocol}//${url.host}`;
}

export type HostSource = 'flag' | 'config' | 'default';

export interface ResolvedHost {
  baseUrl: string;
  source: HostSource;
}

/** `--host` wins over the saved default, which wins over `bifrost.local`. */
export function resolveBaseUrl(flagHost?: string, configuredHost?: string): ResolvedHost {
  if (flagHost !== undefined && flagHost.length > 0) {
    return { baseUrl: normalizeHost(flagHost), source: 'flag' };
  }
  if (configuredHost !== undefined && configuredHost.length > 0) {
    return { baseUrl: normalizeHost(configuredHost), source: 'config' };
  }
  return { baseUrl: DEFAULT_BASE_URL, source: 'default' };
}

/**
 * The one remediation wording. `client.ts` raises it whenever a request fails
 * before a response exists, and `doctor` prints the identical text for its own
 * reachability check — one vocabulary, not two.
 */
export function unreachableMessage(baseUrl: string, cause: string): string {
  return (
    `couldn't reach the Bifrost server at ${baseUrl} (${cause}) — ` +
    'check it is running, or point the CLI at it with ' +
    '--host <address> (or save one with `bifrost config set-host <address>`)'
  );
}

export function unreachable(baseUrl: string, cause: string): CliError {
  return new CliError(unreachableMessage(baseUrl, cause), EXIT.unreachable);
}
