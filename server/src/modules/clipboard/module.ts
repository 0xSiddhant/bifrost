import type { FeatureModule } from '../../core/module.js';
import { registerClipboardRoutes } from './routes/clipboard.js';
import { DbClipboardRepository } from './services/db-clipboard-repository.js';
import {
  AddClipboardEntryUseCase,
  DeleteClipboardEntryUseCase,
  ListClipboardUseCase,
  PruneClipboardUseCase,
} from './usecases/manage-clipboard.js';

/**
 * Shared LAN clipboard (PLAN-06, local profile). Any device posts text; it's
 * persisted, announced on the bus, and fanned out over SSE so every device
 * sees it instantly. Capped with oldest-out; optional per-entry TTL.
 */
export const clipboardModule: FeatureModule = {
  name: 'clipboard',
  register(app, deps) {
    const { config, bus, sse, db } = deps;
    const repo = new DbClipboardRepository(db);
    const maxEntries = config.clipboard.maxEntries;

    const unsubscribe = bus.on('clipboard.updated', (payload) =>
      sse.broadcast('clipboard.updated', payload),
    );

    const prune = new PruneClipboardUseCase(repo, bus, maxEntries);
    prune.execute(); // boot sweep of anything expired/over-cap

    registerClipboardRoutes(app, {
      listEntries: new ListClipboardUseCase(repo),
      addEntry: new AddClipboardEntryUseCase({
        repo,
        bus,
        maxEntries,
        maxTextBytes: config.clipboard.maxTextBytes,
      }),
      deleteEntry: new DeleteClipboardEntryUseCase(repo, bus),
    });

    // Expire TTL entries even when nothing else is posted.
    const timer = setInterval(() => prune.execute(), 60_000);
    timer.unref();

    app.addHook('onClose', () => {
      clearInterval(timer);
      unsubscribe();
    });
  },
};
