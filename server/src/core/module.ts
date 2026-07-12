import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config/index.js';
import type { DbHandle } from './db/index.js';
import type { EventBus } from './bus/index.js';
import type { SseHub } from './sse/index.js';
import type { Logger } from './logger/index.js';

/** Everything a feature module may depend on. Modules receive this — they never import each other. */
export interface ModuleDeps {
  config: AppConfig;
  log: Logger;
  db: DbHandle;
  bus: EventBus;
  sse: SseHub;
}

/**
 * The module contract. The composition root (app.ts) selects modules from the
 * DEPLOY_PROFILE manifest and registers each inside its own Fastify plugin scope.
 */
export interface FeatureModule {
  /** kebab-case, doubles as commit scope and capability name */
  name: string;
  register(app: FastifyInstance, deps: ModuleDeps): Promise<void> | void;
}
