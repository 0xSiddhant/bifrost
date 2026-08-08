import type { FeatureModule } from '../../core/module.js';
import { registerGrootRoutes } from './routes/groot.js';
import { DbGrootRepository } from './services/db-groot-repository.js';
import {
  DeleteGrootUseCase,
  GetGrootUseCase,
  ListGrootsUseCase,
  SaveGrootUseCase,
  UpdateGrootUseCase,
} from './usecases/manage-groots.js';

/**
 * Groot (PLAN-19): the YAML workspace, beside Runestone (JSON) and Edda
 * (Markdown). Its own `groot_docs` table and CRUD, plus `groot.saved` /
 * `groot.deleted` on the bus so the Pensieve live-updates and audit-log records
 * activity.
 *
 * The server stores text and enforces the byte cap; it never parses YAML — see
 * `usecases/manage-groots.ts` for why. Two surfaces: the editor's `/api/groot`
 * CRUD, and the public raw `/groot/api/:slug` data URL.
 */
export const grootModule: FeatureModule = {
  name: 'groot',
  register(app, deps) {
    const { config, bus, sse, db } = deps;
    const repo = new DbGrootRepository(db);
    const maxDocBytes = config.groot.maxDocKb * 1024;

    const unsubscribes = [
      bus.on('groot.saved', (payload) => sse.broadcast('groot.saved', payload)),
      bus.on('groot.deleted', (payload) => sse.broadcast('groot.deleted', payload)),
    ];
    app.addHook('onClose', () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    });

    registerGrootRoutes(app, {
      maxDocKb: config.groot.maxDocKb,
      list: new ListGrootsUseCase(repo),
      save: new SaveGrootUseCase({ repo, bus, maxDocBytes }),
      get: new GetGrootUseCase(repo),
      update: new UpdateGrootUseCase({ repo, bus, maxDocBytes }),
      remove: new DeleteGrootUseCase(repo, bus),
    });
  },
};
