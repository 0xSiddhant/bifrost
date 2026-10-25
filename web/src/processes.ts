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

/** Where the web host runs for a launch: here, in Docker beside this API, or nowhere. */
export const WEB_PLACES = ['native', 'docker', 'none'] as const;
export type WebPlace = (typeof WEB_PLACES)[number];

/** What a launcher was asked for, as flags rather than .env (owner, 2026-10-09). */
export interface RunShape {
  web: WebPlace;
  /** The web host alone, serving the standalone client: no API. */
  standalone: boolean;
  /** Send traces to OTEL_EXPORTER_OTLP_ENDPOINT. */
  otel: boolean;
}

export const DEFAULT_SHAPE: RunShape = { web: 'native', standalone: false, otel: false };

export class RunShapeError extends Error {}

/**
 * The processes a shape runs (`mode`/`advertiser`, for processesFor) and the
 * launcher keys every one of them is given. The API runs as `full` whenever a
 * web host exists, here or in Docker, so it prints the LAN address and the
 * join QR and checks that something answers on PORT.
 *
 * - native: the API + the web host, which answers for bifrost.local
 * - docker: the API + bifrost-mdns, for a web host in Docker that cannot
 *   multicast onto the LAN (the Mac's Docker Desktop)
 * - none: the API alone; nobody answers for the name
 * - standalone: the web host alone, serving the standalone client
 */
export function launchFor(shape: RunShape): {
  mode: RunMode;
  advertiser: MdnsAdvertiser;
  env: { BIFROST_RUN: RunMode; MDNS_ADVERTISER: MdnsAdvertiser; OTEL_ENABLED: 'true' | 'false' };
} {
  if (shape.standalone && shape.web !== 'native') {
    throw new RunShapeError(
      '--standalone runs the web host here; it cannot be combined with --web docker or none',
    );
  }
  if (shape.standalone && shape.otel) {
    throw new RunShapeError('--otel traces the API, and --standalone runs none');
  }
  const OTEL_ENABLED = shape.otel ? 'true' : 'false';
  if (shape.standalone) {
    return {
      mode: 'web',
      advertiser: 'web',
      env: { BIFROST_RUN: 'web', MDNS_ADVERTISER: 'web', OTEL_ENABLED },
    };
  }
  if (shape.web === 'native') {
    return {
      mode: 'full',
      advertiser: 'web',
      env: { BIFROST_RUN: 'full', MDNS_ADVERTISER: 'web', OTEL_ENABLED },
    };
  }
  if (shape.web === 'docker') {
    return {
      mode: 'api',
      advertiser: 'host',
      env: { BIFROST_RUN: 'full', MDNS_ADVERTISER: 'host', OTEL_ENABLED },
    };
  }
  return {
    mode: 'api',
    advertiser: 'off',
    env: { BIFROST_RUN: 'api', MDNS_ADVERTISER: 'off', OTEL_ENABLED },
  };
}

/** `--web native|docker|none`, `--standalone`, `--otel`: the flags every launcher takes. */
export function parseRunShape(argv: string[]): RunShape {
  const shape: RunShape = { ...DEFAULT_SHAPE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const [name, inline] = arg.split(/=(.*)/s, 2) as [string, string | undefined];
    if (name === '--web') {
      const value = inline ?? argv[++i];
      if (!(WEB_PLACES as readonly string[]).includes(value ?? '')) {
        throw new RunShapeError(
          `--web must be ${WEB_PLACES.join(', ')} (got ${value === undefined ? 'nothing' : `"${value}"`})`,
        );
      }
      shape.web = value as WebPlace;
    } else if (arg === '--standalone') {
      shape.standalone = true;
    } else if (arg === '--otel') {
      shape.otel = true;
    } else {
      throw new RunShapeError(
        `unknown option ${arg} (the launchers take --web native|docker|none, --standalone, --otel)`,
      );
    }
  }
  launchFor(shape); // validates the combination
  return shape;
}
