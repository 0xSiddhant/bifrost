import type { FeatureModule } from '../../core/module.js';
import { registerAccioRoutes } from './routes/accio.js';
import { DbAccioRepository } from './services/db-accio-repository.js';
import { HttpTitleFetcher } from './services/http-title-fetcher.js';
import {
  DeleteLinkUseCase,
  EnrichTitleUseCase,
  ListLinksUseCase,
  SaveLinkUseCase,
  UpdateLinkUseCase,
} from './usecases/manage-links.js';

/**
 * Accio (PLAN-13): the read-later shelf. Distinct from Hermes by intent —
 * Hermes *passes* things between devices and forgets them; Accio *summons* them
 * back later — so it owns its own `accio_links` table and never touches
 * clipboard state.
 *
 * Title enrichment is wired here rather than in the route: the save must return
 * the instant the row exists, so the lookup rides the `accio.saved` event and
 * patches the row later via `accio.updated`.
 *
 * Local profile only. A household bookmark shelf has no auth story of its own —
 * revisit for `cloud` when real accounts exist (plan decision).
 */
export const accioModule: FeatureModule = {
  name: 'accio',
  register(app, deps) {
    const { config, log, bus, sse, db } = deps;
    const repo = new DbAccioRepository(db, log);

    const enrich = new EnrichTitleUseCase(
      repo,
      bus,
      new HttpTitleFetcher({
        timeoutMs: config.accio.titleTimeoutMs,
        maxBytes: config.accio.titleMaxBytes,
        log,
      }),
    );

    // Detached lookups must not outlive the server: after onClose we stop
    // starting new ones, and shutdown waits for whatever is already in flight
    // (each is bounded by the fetch timeout, so this can't hang).
    let stopped = false;
    const inFlight = new Set<Promise<void>>();

    const unsubscribes = [
      bus.on('accio.saved', (payload) => {
        sse.broadcast('accio.saved', payload);
        if (stopped || payload.link.title) return;
        const task = enrich
          .execute(payload.link.id)
          .catch((error: unknown) => {
            log.warn({ err: error, id: payload.link.id }, 'accio: title enrichment failed');
          })
          .finally(() => inFlight.delete(task));
        inFlight.add(task);
      }),
      bus.on('accio.updated', (payload) => sse.broadcast('accio.updated', payload)),
      bus.on('accio.deleted', (payload) => sse.broadcast('accio.deleted', payload)),
    ];

    app.addHook('onClose', async () => {
      stopped = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      await Promise.allSettled([...inFlight]);
    });

    registerAccioRoutes(app, {
      list: new ListLinksUseCase(repo),
      save: new SaveLinkUseCase({ repo, bus }),
      update: new UpdateLinkUseCase({ repo, bus }),
      remove: new DeleteLinkUseCase(repo, bus),
    });
  },
};
