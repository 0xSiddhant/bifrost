import fs from 'node:fs';
import path from 'node:path';
import {
  fromRepoRoot,
  isLoopbackHost,
  loadDotenv,
  loadWebConfig,
  WebConfigError,
  type WebConfig,
} from './config.js';
import { buildWebHost } from './host.js';
import { createWebLogger, logsDirProblem, type Logger } from './logger.js';
import { advertiseMdns, type MdnsHandle } from './mdns.js';

/**
 * The web host process (PLAN-36). Started by `scripts/start.ts`, PM2,
 * launchd or compose; reads the shared `.env` like the API server does.
 */

export type MdnsDecision = { advertise: true } | { advertise: false; reason: string };

/** Whether this web host should answer for `<name>.local` (unit-tested; CI cannot multicast). */
export function mdnsDecision(
  config: Pick<WebConfig, 'profile' | 'host' | 'mdnsAdvertiser'>,
): MdnsDecision {
  if (config.profile !== 'local') {
    return { advertise: false, reason: 'the cloud profile is never advertised on a LAN' };
  }
  if (config.mdnsAdvertiser === 'off') {
    return { advertise: false, reason: 'MDNS_ADVERTISER=off' };
  }
  if (config.mdnsAdvertiser === 'host') {
    return {
      advertise: false,
      reason: 'MDNS_ADVERTISER=host: the native advertiser (bifrost-mdns) answers for the name',
    };
  }
  if (isLoopbackHost(config.host)) {
    return {
      advertise: false,
      reason: `WEB_HOST=${config.host} serves this machine only, so advertising a name other devices cannot reach would mislead them`,
    };
  }
  return { advertise: true };
}

/**
 * Whether the advertiser-only process (`bifrost-mdns`, PLAN-39) should answer
 * for the name: only when it was asked to (`MDNS_ADVERTISER=host`), for the
 * local profile. It advertises this machine's own addresses, which is the
 * point: the web host it speaks for may be in a container with none of them.
 */
export function advertiserDecision(
  config: Pick<WebConfig, 'profile' | 'mdnsAdvertiser'>,
): MdnsDecision {
  if (config.profile !== 'local') {
    return { advertise: false, reason: 'the cloud profile is never advertised on a LAN' };
  }
  if (config.mdnsAdvertiser !== 'host') {
    return {
      advertise: false,
      reason: `MDNS_ADVERTISER=${config.mdnsAdvertiser}: ${config.mdnsAdvertiser === 'web' ? 'the web host answers for the name' : 'nobody advertises'}`,
    };
  }
  return { advertise: true };
}

/** Which client a mode serves, and the one command that builds it. */
export function clientFor(config: Pick<WebConfig, 'runMode'>): {
  kind: 'hub' | 'standalone';
  dir: string;
  fix: string;
} {
  return config.runMode === 'web'
    ? { kind: 'standalone', dir: fromRepoRoot('client', 'dist-standalone'), fix: 'npm run build' }
    : { kind: 'hub', dir: fromRepoRoot('client', 'dist'), fix: 'npm run build' };
}

export async function main(): Promise<void> {
  const ignoredEnvKeys = loadDotenv();
  let config: WebConfig;
  try {
    config = loadWebConfig();
  } catch (error) {
    if (error instanceof WebConfigError) {
      process.stderr.write(`web host: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
  const problem = logsDirProblem(config.logsDir);
  if (problem) {
    process.stderr.write(`web host: ${problem}\n`);
    process.exit(1);
  }
  const log: Logger = createWebLogger({
    level: config.logLevel,
    logsDir: config.logsDir,
    retainFiles: config.logRetentionFiles,
    pretty: process.env.NODE_ENV !== 'production',
  });
  if (ignoredEnvKeys.length > 0) {
    log.warn(
      { keys: ignoredEnvKeys },
      `${ignoredEnvKeys.join(', ')} in .env ignored: the launcher decides how a run is shaped. Delete the line from .env`,
    );
  }

  if (config.runMode === 'api') {
    // The launchers never start the web host in this mode. A container still
    // started by compose idles rather than exits: under `restart:
    // unless-stopped`, exiting would only restart it in a loop.
    log.warn(
      'BIFROST_RUN=api runs the API alone; this web host serves nothing and idles until stopped',
    );
    const idle = setInterval(() => {}, 60_000);
    const stop = () => {
      clearInterval(idle);
      log.flush(() => process.exit(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }

  const client = clientFor(config);
  if (!fs.existsSync(path.join(client.dir, 'index.html'))) {
    const message = `no ${client.kind} client build at ${client.dir} — run \`${client.fix}\` first`;
    process.stderr.write(`web host: ${message}\n`);
    log.fatal({ clientDir: client.dir }, `web host refusing to start: ${message}`);
    setTimeout(() => process.exit(1), 300);
    return;
  }

  const app = await buildWebHost(
    client.kind === 'hub'
      ? { kind: 'hub', clientDir: client.dir, upstream: config.api, logger: log }
      : { kind: 'standalone', clientDir: client.dir, logger: log },
  );

  let dying = false;
  const onFatal = (kind: string) => (error: unknown) => {
    if (dying) return;
    dying = true;
    log.fatal({ err: error, kind }, `fatal: ${kind} — exiting`);
    setTimeout(() => process.exit(1), 300);
  };
  process.on('uncaughtException', onFatal('uncaughtException'));
  process.on('unhandledRejection', onFatal('unhandledRejection'));

  await app.listen({ port: config.port, host: config.host });
  log.info(
    {
      host: config.host,
      port: config.port,
      mode: config.runMode,
      client: client.kind,
      api: client.kind === 'hub' ? config.api : null,
    },
    `web host listening on ${config.host}:${config.port} (${client.kind} client)`,
  );

  let mdns: MdnsHandle | null = null;
  const decision = mdnsDecision(config);
  if (decision.advertise) {
    mdns = advertiseMdns(config.mdnsName, config.port, log);
    log.info(`open: http://${config.mdnsName}.local:${config.port}`);
  } else {
    log.info({ reason: decision.reason }, `mdns off: ${decision.reason}`);
  }

  // Order: say goodbye on mDNS, stop accepting and drop the upstream
  // connections, then go. The API drains on its own signal, after this.
  let signalled = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (signalled) process.exit(130);
    signalled = true;
    log.info({ signal }, 'web host shutdown: signal received');
    void (async () => {
      if (mdns) await mdns.stop();
      await app.close();
      log.info('web host shutdown complete');
      log.flush(() => process.exit(0));
      setTimeout(() => process.exit(0), 1_500).unref();
    })();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}
