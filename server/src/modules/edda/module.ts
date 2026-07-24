import type { FeatureModule } from '../../core/module.js';
import { registerEddaRoutes } from './routes/edda.js';
import { DbEddaRepository } from './services/db-edda-repository.js';
import {
  DeleteEddaUseCase,
  GetEddaUseCase,
  ListEddasUseCase,
  SaveEddaUseCase,
  UpdateEddaUseCase,
} from './usecases/manage-eddas.js';

/**
 * Edda (PLAN-11): Markdown viewer/editor with a saved-document library. Its own
 * `eddas` table (never runestones — markdown ≠ JSON semantics) and CRUD plus
 * `edda.saved`/`edda.deleted` on the bus so open libraries live-update and
 * audit-log records activity. Three share surfaces: editor, public preview
 * page (SPA), and the raw `/edda/api/:slug` data URL.
 */
export const eddaModule: FeatureModule = {
  name: 'edda',
  register(app, deps) {
    const { config, bus, sse, db } = deps;
    const repo = new DbEddaRepository(db);
    const maxDocBytes = config.edda.maxDocKb * 1024;

    const unsubscribes = [
      bus.on('edda.saved', (payload) => sse.broadcast('edda.saved', payload)),
      bus.on('edda.deleted', (payload) => sse.broadcast('edda.deleted', payload)),
    ];
    app.addHook('onClose', () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    });

    registerEddaRoutes(app, {
      maxDocKb: config.edda.maxDocKb,
      livePreviewMaxKb: config.edda.livePreviewMaxKb,
      list: new ListEddasUseCase(repo),
      save: new SaveEddaUseCase({ repo, bus, maxDocBytes }),
      get: new GetEddaUseCase(repo),
      update: new UpdateEddaUseCase({ repo, bus, maxDocBytes }),
      remove: new DeleteEddaUseCase(repo, bus),
    });
  },
};
