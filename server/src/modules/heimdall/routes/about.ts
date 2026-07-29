import fs from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../../core/config/index.js';
import { getBuildInfo } from '../../../core/build-info.js';
import { fromRepoRoot } from '../../../core/paths.js';

export interface AboutRoutesDeps {
  config: AppConfig;
}

/**
 * The Heimdall modal's About section (PLAN-10): build stamp, runtime facts, and
 * the changelog. Admin-guarded.
 *
 * This file used to be `observability.ts` and also carried the log tail, the log
 * SSE follow stream, and the runtime level switch. PLAN-16a deleted all three —
 * Grafana/Loki is the log UI now, and `LOG_LEVEL` in `.env` (+ a restart) is the
 * only control — so About is all that remains, and the file is named for it.
 */
export function registerAboutRoutes(app: FastifyInstance, deps: AboutRoutesDeps): void {
  const guard = { preHandler: app.requireAdmin };

  app.get('/api/heimdall/about', guard, () => ({
    ...getBuildInfo(),
    uptimeSeconds: Math.floor(process.uptime()),
    node: process.version,
    host: os.hostname(),
    profile: deps.config.profile,
  }));

  app.get('/api/heimdall/changelog', guard, () => {
    let content = '';
    try {
      content = fs.readFileSync(fromRepoRoot('CHANGELOG.md'), 'utf8');
    } catch {
      // Deliberately silent: there is no CHANGELOG.md before the first release,
      // and the empty string IS the contracted "nothing yet" answer the UI
      // renders. A missing file here is the normal state, not a failure.
    }
    return { content };
  });
}
