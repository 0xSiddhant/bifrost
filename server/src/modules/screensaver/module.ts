import type { FastifyInstance } from 'fastify';
import type { FeatureModule, ModuleDeps } from '../../core/module.js';
import type { ScreensaverSettings } from '../../core/bus/events.js';
import { AppError } from '../../core/http/index.js';
import { readSettings, writeSetting } from '../../core/db/index.js';

/**
 * Nótt (the idle particle screensaver). All animation is client-side canvas —
 * the server owns only the *policy*: whether the saver is offered at all, how
 * long the page must be idle before it appears, particle density, motion band,
 * the line/mouse toggles, and the quote rotation.
 *
 * Same shape as the Loki settings module: DB `settings` overlay over the
 * env-seeded defaults, a public `GET /api/screensaver/config` the client reads
 * to arm the idle timer, an admin `PATCH /api/screensaver/settings`, and a
 * `screensaver.settingsUpdated` broadcast so open clients rebind without a
 * reload. Registered in BOTH profiles; the overlay is additionally gated to
 * desktop pointers client-side.
 */

const SETTING_KEYS = {
  enabled: 'screensaver.enabled',
  idleSeconds: 'screensaver.idleSeconds',
  density: 'screensaver.density',
  motion: 'screensaver.motion',
  connectLines: 'screensaver.connectLines',
  mouseReactive: 'screensaver.mouseReactive',
  showQuotes: 'screensaver.showQuotes',
  quoteRotateSeconds: 'screensaver.quoteRotateSeconds',
} as const;

const IDLE_MIN = 5;
const IDLE_MAX = 3600;
const ROTATE_MIN = 4;
const ROTATE_MAX = 120;
const DENSITIES = ['low', 'medium', 'high'] as const;
const MOTIONS = ['calm', 'normal', 'lively'] as const;

export const screensaverModule: FeatureModule = {
  name: 'screensaver',
  register(app: FastifyInstance, deps: ModuleDeps) {
    const { config, db, bus, sse } = deps;

    /** Effective settings: DB overlay value if present, else the .env default. */
    const effective = (): ScreensaverSettings => {
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
      const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
        const value = rows.get(key);
        return allowed.includes(value as T) ? (value as T) : fallback;
      };
      return {
        enabled: bool(SETTING_KEYS.enabled, config.screensaver.enabled),
        idleSeconds: int(SETTING_KEYS.idleSeconds, config.screensaver.idleSeconds, IDLE_MIN, IDLE_MAX),
        density: oneOf(SETTING_KEYS.density, DENSITIES, config.screensaver.density),
        motion: oneOf(SETTING_KEYS.motion, MOTIONS, config.screensaver.motion),
        connectLines: bool(SETTING_KEYS.connectLines, config.screensaver.connectLines),
        mouseReactive: bool(SETTING_KEYS.mouseReactive, config.screensaver.mouseReactive),
        showQuotes: bool(SETTING_KEYS.showQuotes, config.screensaver.showQuotes),
        quoteRotateSeconds: int(
          SETTING_KEYS.quoteRotateSeconds,
          config.screensaver.quoteRotateSeconds,
          ROTATE_MIN,
          ROTATE_MAX,
        ),
      };
    };

    // Public: the client reads this on load (and via SSE) to arm/disarm the
    // idle timer and configure the canvas. Read-only, carries no secrets. The
    // caps let the Heimdall control clamp its inputs.
    app.get('/api/screensaver/config', () => ({
      ...effective(),
      idleMin: IDLE_MIN,
      idleMax: IDLE_MAX,
      rotateMin: ROTATE_MIN,
      rotateMax: ROTATE_MAX,
    }));

    const guard = { preHandler: app.requireAdmin };
    const patchSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        idleSeconds: { type: 'integer', minimum: IDLE_MIN, maximum: IDLE_MAX },
        density: { type: 'string', enum: DENSITIES },
        motion: { type: 'string', enum: MOTIONS },
        connectLines: { type: 'boolean' },
        mouseReactive: { type: 'boolean' },
        showQuotes: { type: 'boolean' },
        quoteRotateSeconds: { type: 'integer', minimum: ROTATE_MIN, maximum: ROTATE_MAX },
      },
    };

    app.patch<{ Body: Partial<ScreensaverSettings> }>(
      '/api/screensaver/settings',
      { ...guard, schema: { body: patchSchema } },
      (request) => {
        const patch = request.body;
        if (Object.keys(patch).length === 0) {
          throw new AppError('empty settings patch', 400, 'EMPTY_PATCH');
        }
        for (const [field, key] of Object.entries(SETTING_KEYS)) {
          const value = patch[field as keyof ScreensaverSettings];
          if (value !== undefined) writeSetting(db, key, String(value));
        }
        const updated = effective();
        bus.emit('screensaver.settingsUpdated', updated);
        return updated;
      },
    );

    // Live rebind: broadcast changes so open clients pick up new timings/toggles
    // without a reload (same pattern as theme/loki settings updates).
    const unsubscribe = bus.on('screensaver.settingsUpdated', (payload) =>
      sse.broadcast('screensaver.settingsUpdated', payload),
    );
    app.addHook('onClose', unsubscribe);
  },
};
