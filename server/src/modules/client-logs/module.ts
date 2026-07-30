import rateLimit from '@fastify/rate-limit';
import type { FeatureModule } from '../../core/module.js';
import { registerClientLogRoutes } from './routes/client-logs.js';

/**
 * client-logs — the browser's way into the log archive (PLAN-16a).
 *
 * Bifrost is opened from phones and tablets the owner is not sitting at, so a
 * React crash or a failed upload on one of them has no path back today: no
 * console anyone reads, no report, nothing in `storage/logs/`. Server-side
 * logging cannot cover it by construction, because the failure never reaches
 * the server. This is the one observability gap where the data does not exist
 * anywhere at all, as opposed to existing but being hard to query.
 *
 * It rides the existing pipeline rather than a new one: a batched
 * `POST /api/client-logs` is re-emitted through pino with `source: "client"`,
 * so browser errors land in the same files, ship via the same Alloy, and
 * inherit the same backfill and retention — no Faro, no extra container, no
 * second retention story.
 *
 * Registered in BOTH profiles: browsers crash in cloud too.
 */
export const clientLogsModule: FeatureModule = {
  name: 'client-logs',
  async register(app, deps) {
    const { config, log, clientLog } = deps;

    // Scoped to this module's plugin context (file-transfer registers its own
    // for uploads). `global: false` so only routes that opt in are limited.
    await app.register(rateLimit, { global: false });

    registerClientLogRoutes(app, {
      settings: config.clientLogs,
      // Relayed lines are attributed to the browser's feature, so
      // `{module="accio"}` returns both halves of that feature and adding
      // `source="client"` narrows it to the browser side.
      loggerFor: clientLog,
      // This module's OWN lines — a refused batch, a flood — are ordinary
      // server lines: they describe what the endpoint did, not what a browser
      // saw, and must not be attributed to the device.
      log,
    });
  },
};
