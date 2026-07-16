import type { FeatureModule } from '../../core/module.js';
import { AuditRecorder } from './audit-recorder.js';
import { registerAuditRoutes } from './routes/audit.js';
import { DbAuditRepository } from './services/db-audit-repository.js';
import { ListAuditUseCase, PruneAuditUseCase } from './usecases/list-audit.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Activity log (PLAN-06, local profile). A pure bus subscriber: it records
 * cross-module events and serves Heimdall's History page. Nothing imports it —
 * removing it from the manifest stops recording but breaks nothing else.
 */
export const auditLogModule: FeatureModule = {
  name: 'audit-log',
  register(app, deps) {
    const { config, log, db, bus } = deps;
    const repo = new DbAuditRepository(db);

    const recorder = new AuditRecorder(repo, bus);
    recorder.start();

    const prune = new PruneAuditUseCase(repo, config.auditRetentionDays);
    const prunedAtBoot = prune.execute();
    if (prunedAtBoot > 0) log.info({ pruned: prunedAtBoot }, 'audit: pruned expired events');

    registerAuditRoutes(app, { listAudit: new ListAuditUseCase(repo) });

    const timer = setInterval(() => {
      const pruned = prune.execute();
      if (pruned > 0) log.info({ pruned }, 'audit: pruned expired events');
    }, DAY_MS);
    timer.unref();

    app.addHook('onClose', () => {
      clearInterval(timer);
      recorder.stop();
    });
  },
};
