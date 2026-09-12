import type { FeatureModule } from '../../core/module.js';
import { registerAtlasRoutes } from './routes/atlas.js';
import { DbAtlasRepository } from './services/db-atlas-repository.js';
import {
  DeleteAtlasUseCase,
  GetAtlasUseCase,
  ListAtlasUseCase,
  SaveAtlasUseCase,
  UpdateAtlasUseCase,
} from './usecases/manage-atlas-docs.js';

/**
 * Atlas (PLAN-23): XML editor, plist table and library — the fourth structured
 * document workspace beside Runestone (JSON), Edda (Markdown) and Groot (YAML).
 * Its own `atlas_docs` table and CRUD, plus `atlas.saved`/`atlas.deleted` on the
 * bus so open Pensieves live-update and audit-log records activity, and the raw
 * `/atlas/api/:slug` data URL.
 *
 * **The server never parses XML**, and knows nothing about plists. Every
 * document is stored and served as bytes with the byte cap as the only rule —
 * the Edda/Groot contract rather than Runestone's. Whether a document is an
 * Apple property list is decided in the browser, on every load, by looking at
 * what is actually in it; there is no column for it and no server-side sniff,
 * because either would be this module parsing XML by another name.
 */
export const atlasModule: FeatureModule = {
  name: 'atlas',
  register(app, deps) {
    const { config, bus, sse, db } = deps;
    const repo = new DbAtlasRepository(db);
    const maxDocBytes = config.atlas.maxDocKb * 1024;

    const unsubscribes = [
      bus.on('atlas.saved', (payload) => sse.broadcast('atlas.saved', payload)),
      bus.on('atlas.deleted', (payload) => sse.broadcast('atlas.deleted', payload)),
    ];
    app.addHook('onClose', () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    });

    registerAtlasRoutes(app, {
      maxDocKb: config.atlas.maxDocKb,
      list: new ListAtlasUseCase(repo),
      save: new SaveAtlasUseCase({ repo, bus, maxDocBytes }),
      get: new GetAtlasUseCase(repo),
      update: new UpdateAtlasUseCase({ repo, bus, maxDocBytes }),
      remove: new DeleteAtlasUseCase(repo, bus),
    });
  },
};
