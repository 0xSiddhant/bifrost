import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config/index.js';
import type { DbHandle } from './db/index.js';
import type { EventBus } from './bus/index.js';
import type { SseHub } from './sse/index.js';
import type { Logger } from './logger/index.js';
import type { AuthService } from './auth/index.js';

/** Everything a feature module may depend on. Modules receive this — they never import each other. */
export interface ModuleDeps {
  config: AppConfig;
  log: Logger;
  db: DbHandle;
  bus: EventBus;
  sse: SseHub;
  /** PIN-session service; only Heimdall uses it (login/logout/revoke). */
  auth: AuthService;
  /**
   * A logger for lines this process did not produce — browser reports relayed
   * through `POST /api/client-logs`. Only the `client-logs` module uses it.
   *
   * It is a factory off the ROOT logger rather than something a module could
   * derive from its own `log`, because pino appends child bindings to the
   * parent's: `log.child({ source: 'client' })` on a `source: 'server'` module
   * logger would write `source` twice per line (see `core/logger`).
   */
  clientLog: (moduleName: string) => Logger;
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
