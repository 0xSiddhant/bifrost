import type { FastifyInstance } from 'fastify';
import type { FeatureModule, ModuleDeps } from '../../core/module.js';
import type { OfflineModeConfig, OfflineModeTarget } from '../../core/bus/events.js';
import { AppError } from '../../core/http/index.js';
import { readSettings, writeSetting } from '../../core/db/index.js';

/**
 * Offline mode (PLAN-22). The mechanism that keeps an already-open tab working
 * after the LAN drops is 100% client-side — an eager `import()` of the pages
 * that compute locally — so this module owns only the *policy*: which of the
 * warmable pages an admin has left enabled.
 *
 * Same shape as the screensaver module: a public `GET /api/offline-mode/config`
 * the client reads to decide what to warm, an admin
 * `PATCH /api/offline-mode/settings`, and an `offlineMode.settingsUpdated`
 * broadcast so open tabs rebind without a reload. The registry itself is
 * code-owned (pages come and go through code changes, not admin typing); only
 * the disabled ids are stored, as one comma-separated `settings` row — the same
 * overlay `themes.disabled` uses, so there is no new table and no migration.
 *
 * Registered in BOTH profiles: warming client chunks is harmless mechanism, not
 * a LAN-trust concern (matching `toolbox`/`variant`/`screensaver`).
 */

/** DB `settings` key holding the comma-separated disabled target ids. */
const DISABLED_KEY = 'offlineMode.disabledTargets';

/**
 * The warmable pages. Ids are stable identifiers the client maps to its own
 * `import()` loaders — loaders cannot travel over the wire, so the registry
 * ships as data and the loader map stays code-only on the client
 * (`client/src/app/offlineWarmLoad.ts`). Keep the two lists in step.
 *
 * Granularity is page-level: Diagon Alley's thirteen tools ship as one lazy
 * chunk (PLAN-18), so a per-tool entry would not change what gets fetched.
 */
const TARGETS: readonly OfflineModeTarget[] = [
  { id: 'toolbox', label: 'Diagon Alley toolbox' },
  { id: 'runestone', label: 'Runestone (JSON)' },
  { id: 'groot', label: 'Groot (YAML)' },
  { id: 'edda', label: 'Edda (Markdown)' },
  { id: 'variant', label: 'Variant (diff)' },
  { id: 'loki', label: 'Loki (JS workbench)' },
];

const TARGET_IDS = TARGETS.map((target) => target.id);

export const offlineModeModule: FeatureModule = {
  name: 'offline-mode',
  register(app: FastifyInstance, deps: ModuleDeps) {
    const { db, bus, sse, log } = deps;

    const disabledIds = (): string[] => {
      const row = readSettings(db).find((entry) => entry.key === DISABLED_KEY);
      if (!row || !row.value) return [];
      const stored = new Set(
        row.value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      );
      // Filtered through the registry so an id left behind by a removed page
      // cannot disable something that no longer exists — or reappear as a
      // phantom entry in the Heimdall list.
      return TARGET_IDS.filter((id) => stored.has(id));
    };

    const effective = (): OfflineModeConfig => ({ targets: [...TARGETS], disabled: disabledIds() });

    // Public: the client reads this on load (and via SSE) to know which targets
    // its toggle should warm. Read-only, carries no secrets.
    app.get('/api/offline-mode/config', () => effective());

    const patchSchema = {
      type: 'object',
      required: ['id', 'enabled'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 40 },
        enabled: { type: 'boolean' },
      },
    };

    app.patch<{ Body: { id: string; enabled: boolean } }>(
      '/api/offline-mode/settings',
      { preHandler: app.requireAdmin, schema: { body: patchSchema } },
      (request) => {
        const { id, enabled } = request.body;
        if (!TARGET_IDS.includes(id)) {
          // An id the registry never had means the admin UI and the server
          // disagree about what exists — worth a line, since the checkbox the
          // user clicked will silently do nothing.
          log.warn({ id }, 'offline-mode patch for unknown target');
          throw new AppError(`unknown offline-mode target: ${id}`, 404, 'UNKNOWN_TARGET');
        }
        const next = new Set(disabledIds());
        if (enabled) next.delete(id);
        else next.add(id);
        writeSetting(db, DISABLED_KEY, TARGET_IDS.filter((entry) => next.has(entry)).join(','));

        const updated = effective();
        bus.emit('offlineMode.settingsUpdated', updated);
        return updated;
      },
    );

    // Live rebind: an admin narrowing the registry must reach tabs that are
    // already open, so the next toggle click warms the new set (same pattern as
    // theme/loki/screensaver settings updates).
    const unsubscribe = bus.on('offlineMode.settingsUpdated', (payload) =>
      sse.broadcast('offlineMode.settingsUpdated', payload),
    );
    app.addHook('onClose', unsubscribe);
  },
};
