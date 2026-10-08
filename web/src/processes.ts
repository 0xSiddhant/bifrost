import type { ChildSpec } from './supervise.js';
import type { MdnsAdvertiser, RunMode } from './config.js';

/**
 * Which processes a run needs (PLAN-36, PLAN-39): `npm start` runs exactly
 * these, and PM2 and launchd mirror them as `bifrost-api`, `bifrost-web` and
 * `bifrost-mdns`.
 *
 * - `full` → the API, then the web host; `api` → the API; `web` → the web host.
 * - `MDNS_ADVERTISER=host` adds the native advertiser, for a web host in a
 *   container that cannot multicast onto the LAN (the Mac's Docker Desktop).
 */
export function processesFor(mode: RunMode, advertiser: MdnsAdvertiser, cwd: string): ChildSpec[] {
  const api: ChildSpec = {
    name: 'api',
    command: process.execPath,
    // --import, not an import inside bootstrap: ESM hoists, so the OTel SDK must
    // load before the app or its instrumentations patch nothing (PLAN-16b).
    args: ['--import', './server/dist/otel.js', 'server/dist/bootstrap.js'],
    cwd,
  };
  const web: ChildSpec = {
    name: 'web',
    command: process.execPath,
    args: ['web/dist/bootstrap.js'],
    cwd,
  };
  const mdns: ChildSpec = {
    name: 'mdns',
    command: process.execPath,
    args: ['web/dist/advertise.js'],
    cwd,
  };
  // The API first, so the web host's first proxied request has somewhere to go.
  const base = mode === 'api' ? [api] : mode === 'web' ? [web] : [api, web];
  return advertiser === 'host' ? [...base, mdns] : base;
}
