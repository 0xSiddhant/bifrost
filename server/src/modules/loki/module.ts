import type { FastifyInstance } from 'fastify';
import type { FeatureModule, ModuleDeps } from '../../core/module.js';
import type { LokiSettings } from '../../core/bus/events.js';
import { AppError } from '../../core/http/index.js';
import { readSettings, writeSetting } from '../../core/db/index.js';

/**
 * Loki (PLAN-12): the JavaScript workbench. Part A's transforms and the regex
 * tester are pure client compute, and Part B's runner ("Calcifer") is a
 * client-side Web Worker, so the server owns no execution logic — but it does
 * own the runner's *policy*: whether execution is offered at all, whether a run
 * may call fetch(), the watchdog timeout, and the console budget.
 *
 * These ride the DB `settings` table (env-seeded, Heimdall-writable) exposed as
 * a public `GET /api/loki/config` the page reads to honour the gates live, plus
 * an admin `PATCH /api/loki/settings`. A `loki.settingsUpdated` broadcast lets
 * open pages + the Heimdall card rebind without a reload.
 *
 * Registered in BOTH profiles (transforms/regex everywhere); the run UI is
 * additionally gated client-side on `capabilities.profile === 'local'`.
 */

const SETTING_KEYS = {
  executionEnabled: 'loki.executionEnabled',
  fetchAllowed: 'loki.fetchAllowed',
  runTimeoutMs: 'loki.runTimeoutMs',
  consoleMaxEntries: 'loki.consoleMaxEntries',
} as const;

const TIMEOUT_MIN = 250;
const TIMEOUT_MAX = 30000;
const BUDGET_MIN = 10;
const BUDGET_MAX = 5000;

export const lokiModule: FeatureModule = {
  name: 'loki',
  register(app: FastifyInstance, deps: ModuleDeps) {
    const { config, db, bus, sse } = deps;

    /** Effective settings: DB overlay value if present, else the .env default. */
    const effective = (): LokiSettings => {
      const rows = new Map(readSettings(db).map((row) => [row.key, row.value]));
      const bool = (key: string, fallback: boolean): boolean => {
        const value = rows.get(key);
        return value === undefined ? fallback : value === 'true';
      };
      const int = (key: string, fallback: number, min: number, max: number): number => {
        const value = rows.get(key);
        const n = value === undefined ? NaN : Number(value);
        return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
      };
      return {
        executionEnabled: bool(SETTING_KEYS.executionEnabled, config.loki.executionEnabled),
        fetchAllowed: bool(SETTING_KEYS.fetchAllowed, config.loki.fetchAllowed),
        runTimeoutMs: int(SETTING_KEYS.runTimeoutMs, config.loki.runTimeoutMs, TIMEOUT_MIN, TIMEOUT_MAX),
        consoleMaxEntries: int(
          SETTING_KEYS.consoleMaxEntries,
          config.loki.consoleMaxEntries,
          BUDGET_MIN,
          BUDGET_MAX,
        ),
      };
    };

    // Public: the page reads this to gate the Run UI and pass the runner its
    // limits. Read-only; carries no secrets. Also exposes the caps so the
    // per-run timeout control can clamp itself.
    app.get('/api/loki/config', () => ({
      ...effective(),
      timeoutMin: TIMEOUT_MIN,
      timeoutMax: TIMEOUT_MAX,
    }));

    const guard = { preHandler: app.requireAdmin };
    const patchSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        executionEnabled: { type: 'boolean' },
        fetchAllowed: { type: 'boolean' },
        runTimeoutMs: { type: 'integer', minimum: TIMEOUT_MIN, maximum: TIMEOUT_MAX },
        consoleMaxEntries: { type: 'integer', minimum: BUDGET_MIN, maximum: BUDGET_MAX },
      },
    };

    app.patch<{
      Body: Partial<{
        executionEnabled: boolean;
        fetchAllowed: boolean;
        runTimeoutMs: number;
        consoleMaxEntries: number;
      }>;
    }>('/api/loki/settings', { ...guard, schema: { body: patchSchema } }, (request) => {
      const patch = request.body;
      if (Object.keys(patch).length === 0) {
        throw new AppError('empty settings patch', 400, 'EMPTY_PATCH');
      }
      if (patch.executionEnabled !== undefined) {
        writeSetting(db, SETTING_KEYS.executionEnabled, String(patch.executionEnabled));
      }
      if (patch.fetchAllowed !== undefined) {
        writeSetting(db, SETTING_KEYS.fetchAllowed, String(patch.fetchAllowed));
      }
      if (patch.runTimeoutMs !== undefined) {
        writeSetting(db, SETTING_KEYS.runTimeoutMs, String(patch.runTimeoutMs));
      }
      if (patch.consoleMaxEntries !== undefined) {
        writeSetting(db, SETTING_KEYS.consoleMaxEntries, String(patch.consoleMaxEntries));
      }
      const updated = effective();
      bus.emit('loki.settingsUpdated', updated);
      return updated;
    });

    // Live rebind: broadcast changes so open Loki pages + the Heimdall card
    // reflect them without a reload (same pattern as theme/settings updates).
    const unsubscribe = bus.on('loki.settingsUpdated', (payload) =>
      sse.broadcast('loki.settingsUpdated', payload),
    );
    app.addHook('onClose', unsubscribe);
  },
};
