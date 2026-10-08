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
import { createWebLogger, type Logger } from './logger.js';
import { advertiseMdns, type MdnsHandle } from './mdns.js';

/**
 * The web host process (PLAN-36). Started by `scripts/start.ts`, PM2,
 * launchd or compose; reads the shared `.env` like the API server does.
 */

export type MdnsDecision = { advertise: true } | { advertise: false; reason: string };

/** Whether this web host should answer for `<name>.local` (unit-tested; CI cannot multicast). */
export function mdnsDecision(config: Pick<WebConfig, 'profile' | 'host'>): MdnsDecision {
  if (config.profile !== 'local') {
    return { advertise: false, reason: 'the cloud profile is never advertised on a LAN' };
  }
  if (isLoopbackHost(config.host)) {
    return {
      advertise: false,
      reason: `WEB_HOST=${config.host} serves this machine only, so advertising a name other devices cannot reach would mislead them`,
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
  loadDotenv();
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
  const log: Logger = createWebLogger({
    level: config.logLevel,
    logsDir: config.logsDir,
    retainFiles: config.logRetentionFiles,
    pretty: process.env.NODE_ENV !== 'production',
  });

  if (config.runMode === 'api') {
    log.info(
      'BIFROST_RUN=api runs the API alone; this mode has no web host, so it is not starting',
    );
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
