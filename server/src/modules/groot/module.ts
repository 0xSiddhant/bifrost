import type { FeatureModule } from '../../core/module.js';
import { registerGrootRoutes } from './routes/groot.js';
import { DbGrootRepository } from './services/db-groot-repository.js';
import {
  DeleteGrootUseCase,
  GetGrootUseCase,
  ListGrootUseCase,
  SaveGrootUseCase,
  UpdateGrootUseCase,
} from './usecases/manage-groot-docs.js';

/**
 * Groot (PLAN-19): YAML editor, viewer and library — the third structured-text
 * workspace beside Runestone (JSON) and Edda (Markdown). Its own `groot_docs`
 * table and CRUD, plus `groot.saved`/`groot.deleted` on the bus so open
 * Pensieves live-update and audit-log records activity, and the raw
 * `/groot/api/:slug` data URL.
 *
 * **The server never parses YAML.** It stores text and enforces the byte cap,
 * which is Edda's contract rather than Runestone's: alias expansion is a
 * billion-laughs amplifier, so the size cap does not bound a parse, and
 * `/groot/api/:slug` promises "the bytes that were saved" — the same promise
 * Edda's markdown endpoint makes — not "valid YAML". Every parse in this
 * feature happens in the browser, under `maxAliasCount`.
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
      list: new ListGrootUseCase(repo),
      save: new SaveGrootUseCase({ repo, bus, maxDocBytes }),
      get: new GetGrootUseCase(repo),
      update: new UpdateGrootUseCase({ repo, bus, maxDocBytes }),
      remove: new DeleteGrootUseCase(repo, bus),
    });
  },
};
