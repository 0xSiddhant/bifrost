import type { FeatureModule } from '../../core/module.js';
import { registerRunestoneRoutes } from './routes/runestone.js';
import { DbRunestoneRepository } from './services/db-runestone-repository.js';
import {
  DeleteRunestoneUseCase,
  GetRunestoneUseCase,
  ListRunestonesUseCase,
  SaveRunestoneUseCase,
  UpdateRunestoneUseCase,
} from './usecases/manage-runestones.js';

/**
 * Runestone (PLAN-07): JSON viewer/editor with a saved-document library.
 * Part A is client-side (the server only publishes the size cap); Part B adds
 * CRUD over `runestones` plus `runestone.saved`/`runestone.deleted` on the
 * bus so open libraries live-update and audit-log records activity.
 */
export const runestoneModule: FeatureModule = {
  name: 'runestone',
  register(app, deps) {
    const { config, bus, sse, db } = deps;
    const repo = new DbRunestoneRepository(db);
    const maxDocBytes = config.runestone.maxDocKb * 1024;

    const unsubscribes = [
      bus.on('runestone.saved', (payload) => sse.broadcast('runestone.saved', payload)),
      bus.on('runestone.deleted', (payload) => sse.broadcast('runestone.deleted', payload)),
    ];
    app.addHook('onClose', () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    });

    registerRunestoneRoutes(app, {
      maxDocKb: config.runestone.maxDocKb,
      list: new ListRunestonesUseCase(repo),
      save: new SaveRunestoneUseCase({ repo, bus, maxDocBytes }),
      get: new GetRunestoneUseCase(repo),
      update: new UpdateRunestoneUseCase({ repo, bus, maxDocBytes }),
      remove: new DeleteRunestoneUseCase(repo, bus),
    });
  },
};
