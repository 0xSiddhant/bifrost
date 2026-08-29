import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  applySettingsOverlay,
  ConfigError,
  DEFAULT_LOG_RETENTION_FILES,
  loadConfig,
  logsDirFromEnv,
  type AppConfig,
  type DeployProfile,
} from './core/config/index.js';
import { loadDotenv } from './core/config/dotenv.js';
import { clientLogger, createLogger, moduleLogger, type Logger } from './core/logger/index.js';
import { checkpointAndClose, openDb, readSettings, runMigrations, writeSetting } from './core/db/index.js';
import { EventBus } from './core/bus/index.js';
import { SseHub } from './core/sse/index.js';
import { buildHttp } from './core/http/index.js';
import { AuthService, registerAuth } from './core/auth/index.js';
import { advertiseMdns, lanIPv4Addresses, type MdnsHandle } from './core/mdns/index.js';
import { fromRepoRoot } from './core/paths.js';
import type { FeatureModule } from './core/module.js';
import { healthModule } from './modules/health/module.js';
import { fileTransferModule } from './modules/file-transfer/module.js';
import { previewsModule } from './modules/previews/module.js';
import { qrToolModule, serverUrls, terminalQr } from './modules/qr-tool/module.js';
import { themesModule } from './modules/themes/module.js';
import { heimdallModule } from './modules/heimdall/module.js';
import { clipboardModule } from './modules/clipboard/module.js';
import { presenceModule } from './modules/presence/module.js';
import { auditLogModule } from './modules/audit-log/module.js';
import { runestoneModule } from './modules/runestone/module.js';
import { variantModule } from './modules/variant/module.js';
import { eddaModule } from './modules/edda/module.js';
import { grootModule } from './modules/groot/module.js';
import { lokiModule } from './modules/loki/module.js';
import { accioModule } from './modules/accio/module.js';
import { nimbusModule } from './modules/nimbus/module.js';
import { portkeyModule } from './modules/portkey/module.js';
import { screensaverModule } from './modules/screensaver/module.js';
import { clientLogsModule } from './modules/client-logs/module.js';
import { metricsModule } from './modules/metrics/module.js';
import { toolboxModule } from './modules/toolbox/module.js';
import { offlineModeModule } from './modules/offline-mode/module.js';

/**
 * Deployment manifest: which modules each profile loads (architecture rule 3).
 * `local` = everything; `cloud` = internet-safe modules only. Feature plans
 * append here as modules come into existence.
 */
const MANIFEST: Record<DeployProfile, FeatureModule[]> = {
  local: [
    healthModule,
    fileTransferModule,
    previewsModule,
    qrToolModule,
    themesModule,
    heimdallModule,
    clipboardModule,
    presenceModule,
    auditLogModule,
    runestoneModule,
    variantModule,
    eddaModule,
    grootModule,
    lokiModule,
    // Local only: a household bookmark shelf has no auth story of its own
    // (PLAN-13 decision) — revisit for cloud when real accounts exist.
    accioModule,
    // Local only: it measures the LAN path to this machine, and an open
    // byte-firehose on a public host is a bandwidth bill (PLAN-14).
    nimbusModule,
    // Local only, permanently: a public go-links service is an open-redirect /
    // phishing primitive; on the LAN it's a convenience (PLAN-15).
    portkeyModule,
    screensaverModule,
    // Both profiles: browsers crash in cloud too, and a phone's crash reaches
    // the archive through nothing else (PLAN-16a).
    clientLogsModule,
    // Both profiles: the snapshot is the durable runtime record, and it has to
    // exist whether or not any container is running (PLAN-16b).
    metricsModule,
    // Capability-only, both profiles: the toolbox is pure client compute, so
    // this entry is purely the on/off switch for the Diagon Alley tools.
    toolboxModule,
    // Both profiles: policy only for the client-side warm load (PLAN-22) —
    // harmless mechanism, not a LAN-trust concern.
    offlineModeModule,
  ],
  cloud: [
    healthModule,
    qrToolModule,
    themesModule,
    heimdallModule,
    runestoneModule,
    variantModule,
    eddaModule,
    grootModule,
    lokiModule,
    screensaverModule,
    clientLogsModule,
    metricsModule,
    toolboxModule,
    offlineModeModule,
  ],
};

const SESSION_EPOCH_KEY = 'heimdall.sessionEpoch';

export interface RunningApp {
  fastify: FastifyInstance;
  config: AppConfig;
  /** `reason` is recorded on the first shutdown line — a signal name, or why else. */
  shutdown: (reason?: string) => Promise<void>;
}

interface CreateAppOptions {
  /** Test hook: inject a silent logger instead of the file/pretty transports. */
  logger?: Logger;
}

export async function createApp(
  baseConfig: AppConfig,
  options: CreateAppOptions = {},
): Promise<RunningApp> {
  const logger =
    options.logger ??
    createLogger({
      level: baseConfig.logLevel,
      logsDir: baseConfig.storage.logs,
      pretty: process.env.NODE_ENV !== 'production',
      retainFiles: baseConfig.logRetentionFiles,
    });

  ensureStorageDirs(baseConfig);
  sweepTmp(baseConfig.storage.tmp, logger);

  const db = openDb(baseConfig.storage.dbFile);
  runMigrations(db);
  const settingsRows = readSettings(db);
  const config = applySettingsOverlay(baseConfig, settingsRows);

  // Session epoch persists across restarts so a "revoke all" stays in effect.
  const epochRow = settingsRows.find((row) => row.key === SESSION_EPOCH_KEY);
  const initialEpoch = epochRow ? Number(epochRow.value) : 0;
  const auth = new AuthService(config.heimdall.pin, initialEpoch, (epoch) =>
    writeSetting(db, SESSION_EPOCH_KEY, String(epoch)),
  );
  if (config.heimdall.sessionSecret === null) {
    logger.warn('HEIMDALL_SESSION_SECRET unset — admin sessions reset on restart');
  }

  const bus = new EventBus();
  const sse = new SseHub();

  const fastify = await buildHttp({ logger, clientDistDir: fromRepoRoot('client', 'dist'), bus });
  await registerAuth(fastify, { sessionSecret: config.heimdall.sessionSecret, auth });
  sse.register(fastify, logger);

  // Relayed browser lines are siblings of the module loggers, not descendants —
  // both hang off the source-free root so each line carries exactly one
  // `source` (pino appends child bindings; see core/logger).
  const clientLog = (moduleName: string): Logger => clientLogger(logger, moduleName);

  const modules = MANIFEST[config.profile];
  for (const mod of modules) {
    const log = moduleLogger(logger, mod.name);
    await fastify.register(async (scope) => {
      await mod.register(scope, { config, log, db, bus, sse, auth, clientLog });
    });
    logger.info({ module: mod.name }, 'module loaded');
  }

  fastify.get('/api/capabilities', () => ({
    profile: config.profile,
    modules: modules.map((mod) => mod.name),
  }));

  let closed = false;
  const shutdown = async (reason = 'unspecified'): Promise<void> => {
    if (closed) return;
    closed = true;
    // Why the process is going down is the first thing you want when reading
    // back a gap in the archive: a clean SIGTERM from PM2 and a shutdown
    // triggered by a listen failure produce the same sequence of lines below.
    logger.info({ reason }, 'shutdown: starting');
    logger.info('shutdown: closing sse clients');
    sse.close();
    logger.info('shutdown: closing http server');
    await fastify.close();
    bus.removeAllListeners();
    logger.info('shutdown: checkpointing database');
    checkpointAndClose(db);
    logger.info('shutdown complete');
    await flushLogs(logger);
  };

  return { fastify, config, shutdown };
}

function ensureStorageDirs(config: AppConfig): void {
  const { uploads, downloads, tmp, data, logs } = config.storage;
  for (const dir of [uploads, downloads, tmp, data, logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Aborted uploads only ever leave junk in tmp/ — clear it on every boot. */
function sweepTmp(tmpDir: string, log: Logger): void {
  if (!fs.existsSync(tmpDir)) return;
  const entries = fs.readdirSync(tmpDir).filter((name) => name !== '.gitkeep');
  for (const entry of entries) {
    fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
  }
  if (entries.length > 0) log.info({ swept: entries.length }, 'tmp swept on boot');
}

/** Longest we'll wait on the log transport before giving up on it. */
const FLUSH_TIMEOUT_MS = 1500;

/**
 * Wait for the log transport to drain — but never indefinitely.
 *
 * pino's `flush(cb)` **never invokes the callback** if the transport worker is
 * still starting up, which is exactly the situation on the paths that use this:
 * a bad `.env` or an uncaught throw seconds into boot. Awaiting it unbounded
 * hangs the process instead of exiting (observed: exit code 0 on a config
 * failure that must exit 1). thread-stream flushes on process exit anyway, so
 * the bound costs nothing — the line still lands.
 */
async function flushLogs(logger: Logger): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    new Promise<void>((resolve) => logger.flush(() => resolve())),
    // Deliberately NOT `.unref()`d: an unref'd timer lets an otherwise-idle
    // loop exit before it fires, so the process ends on its own with code 0
    // and never reaches the `process.exit(code)` this is guarding. It is
    // cleared the moment the flush callback wins, so it delays nothing.
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

/** Write one last line, give it a chance to land, then go. */
async function flushAndExit(logger: Logger, code: number): Promise<never> {
  await flushLogs(logger);
  process.exit(code);
}

export async function main(): Promise<void> {
  loadDotenv();

  let baseConfig: AppConfig;
  try {
    baseConfig = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // stderr AND the archive. stderr alone is what this used to do, and it is
      // invisible under PM2/launchd — an invalid .env is the commonest startup
      // failure there is, and it was the one failure that never reached Loki.
      process.stderr.write(`${error.message}\n`);
      const logger = createLogger({
        level: 'fatal',
        logsDir: logsDirFromEnv(),
        pretty: false,
        retainFiles: DEFAULT_LOG_RETENTION_FILES,
      });
      logger.fatal({ err: error }, 'fatal: invalid configuration — refusing to start');
      await flushAndExit(logger, 1);
    }
    throw error;
  }

  const app = await createApp(baseConfig);
  const { fastify, config } = app;
  const rootLog = fastify.log as Logger;

  // A crash used to leave nothing at all behind — the exact case the archive
  // exists to explain. Deliberately no graceful shutdown: process state is
  // unknown after an uncaught throw, so record it and go, rather than risk
  // hanging in a close path and losing the line too.
  let dying = false;
  const onFatal = (kind: string) => (error: unknown) => {
    if (dying) return;
    dying = true;
    rootLog.fatal({ err: error, kind }, `fatal: ${kind} — exiting`);
    void flushAndExit(rootLog, 1);
  };
  process.on('uncaughtException', onFatal('uncaughtException'));
  process.on('unhandledRejection', onFatal('unhandledRejection'));

  await fastify.listen({ port: config.port, host: '0.0.0.0' });

  let mdns: MdnsHandle | null = null;
  if (config.profile === 'local') {
    mdns = advertiseMdns(config.mdnsName, config.port, fastify.log as Logger);
    fastify.log.info(`bifrost up: http://${config.mdnsName}.local:${config.port}`);
  }
  for (const address of lanIPv4Addresses()) {
    fastify.log.info(`lan address: http://${address}:${config.port}`);
  }
  const [primaryUrl] = serverUrls(config);
  if (primaryUrl) {
    // Straight to stdout, not the logger: a multi-line ASCII QR inside a JSON
    // log line would be unreadable. Android fallback per tech-stack.md.
    process.stdout.write(`\nscan to join bifrost (${primaryUrl}):\n${await terminalQr(primaryUrl)}\n`);
  }

  let signalled = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (signalled) process.exit(130);
    signalled = true;
    fastify.log.info({ signal }, 'shutdown: signal received');
    void (async () => {
      if (mdns) await mdns.stop();
      await app.shutdown(`signal ${signal}`);
      process.exit(0);
    })();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}

// Self-start only when this file IS the direct entry (e.g. `node dist/app.js`,
// or tsx in tests). Process managers that wrap/import the entry — notably PM2's
// fork mode — must use the dedicated bootstrap entry (server/src/bootstrap.ts),
// which calls main() unconditionally.
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  void main();
}
