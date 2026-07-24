import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  applySettingsOverlay,
  ConfigError,
  loadConfig,
  type AppConfig,
  type DeployProfile,
} from './core/config/index.js';
import { loadDotenv } from './core/config/dotenv.js';
import { createLogger, moduleLogger, type Logger } from './core/logger/index.js';
import { LogTap } from './core/logtap.js';
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
import { lokiModule } from './modules/loki/module.js';

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
    lokiModule,
  ],
  cloud: [
    healthModule,
    qrToolModule,
    themesModule,
    heimdallModule,
    runestoneModule,
    variantModule,
    eddaModule,
    lokiModule,
  ],
};

const SESSION_EPOCH_KEY = 'heimdall.sessionEpoch';

export interface RunningApp {
  fastify: FastifyInstance;
  config: AppConfig;
  shutdown: () => Promise<void>;
}

interface CreateAppOptions {
  /** Test hook: inject a silent logger instead of the file/pretty transports. */
  logger?: Logger;
}

export async function createApp(
  baseConfig: AppConfig,
  options: CreateAppOptions = {},
): Promise<RunningApp> {
  const logTap = new LogTap();
  const logger =
    options.logger ??
    createLogger(
      {
        level: baseConfig.logLevel,
        logsDir: baseConfig.storage.logs,
        pretty: process.env.NODE_ENV !== 'production',
      },
      logTap,
    );

  ensureStorageDirs(baseConfig);
  sweepTmp(baseConfig.storage.tmp, logger);

  const db = openDb(baseConfig.storage.dbFile);
  runMigrations(db);
  const settingsRows = readSettings(db);
  const config = applySettingsOverlay(baseConfig, settingsRows);
  // Apply a persisted log level (Heimdall's runtime switch) before any module
  // child loggers are created, so they inherit it. Skip when a logger was
  // injected (tests own its level — e.g. a silent one).
  if (!options.logger) logger.level = config.logLevel;

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

  const fastify = await buildHttp({ logger, clientDistDir: fromRepoRoot('client', 'dist') });
  await registerAuth(fastify, { sessionSecret: config.heimdall.sessionSecret, auth });
  sse.register(fastify, logger);

  // Live log-level switch (Heimdall Logs): set on the root and every module
  // child (pino children don't inherit a level change after creation).
  const moduleLoggers: Logger[] = [];
  const setLogLevel = (level: AppConfig['logLevel']): void => {
    logger.level = level;
    for (const child of moduleLoggers) child.level = level;
  };

  const modules = MANIFEST[config.profile];
  for (const mod of modules) {
    const log = moduleLogger(logger, mod.name);
    moduleLoggers.push(log);
    await fastify.register(async (scope) => {
      await mod.register(scope, { config, log, db, bus, sse, auth, logTap, setLogLevel });
    });
    logger.info({ module: mod.name }, 'module loaded');
  }

  fastify.get('/api/capabilities', () => ({
    profile: config.profile,
    modules: modules.map((mod) => mod.name),
  }));

  let closed = false;
  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    logger.info('shutdown: closing sse clients');
    sse.close();
    logger.info('shutdown: closing http server');
    await fastify.close();
    bus.removeAllListeners();
    logger.info('shutdown: checkpointing database');
    checkpointAndClose(db);
    logger.info('shutdown complete');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));
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

export async function main(): Promise<void> {
  loadDotenv();

  let baseConfig: AppConfig;
  try {
    baseConfig = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const app = await createApp(baseConfig);
  const { fastify, config } = app;

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
      await app.shutdown();
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
