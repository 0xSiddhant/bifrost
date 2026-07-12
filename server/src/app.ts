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
import { checkpointAndClose, openDb, readSettings, runMigrations } from './core/db/index.js';
import { EventBus } from './core/bus/index.js';
import { SseHub } from './core/sse/index.js';
import { buildHttp } from './core/http/index.js';
import { registerAuth } from './core/auth/index.js';
import { advertiseMdns, lanIPv4Addresses, type MdnsHandle } from './core/mdns/index.js';
import { fromRepoRoot } from './core/paths.js';
import type { FeatureModule } from './core/module.js';
import { healthModule } from './modules/health/module.js';

/**
 * Deployment manifest: which modules each profile loads (architecture rule 3).
 * `local` = everything; `cloud` = internet-safe modules only. Feature plans
 * append here as modules come into existence.
 */
const MANIFEST: Record<DeployProfile, FeatureModule[]> = {
  local: [healthModule],
  cloud: [healthModule],
};

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
  const logger =
    options.logger ??
    createLogger({
      level: baseConfig.logLevel,
      logsDir: baseConfig.storage.logs,
      pretty: process.env.NODE_ENV !== 'production',
    });

  ensureStorageDirs(baseConfig);
  sweepTmp(baseConfig.storage.tmp, logger);

  const db = openDb(baseConfig.storage.dbFile);
  runMigrations(db);
  const config = applySettingsOverlay(baseConfig, readSettings(db));

  const bus = new EventBus();
  const sse = new SseHub();

  const fastify = await buildHttp({ logger, clientDistDir: fromRepoRoot('client', 'dist') });
  await registerAuth(fastify);
  sse.register(fastify, logger);

  const modules = MANIFEST[config.profile];
  for (const mod of modules) {
    await fastify.register(async (scope) => {
      await mod.register(scope, { config, log: moduleLogger(logger, mod.name), db, bus, sse });
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

async function main(): Promise<void> {
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

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  void main();
}
