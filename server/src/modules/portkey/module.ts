import type { FeatureModule } from '../../core/module.js';
import { registerPortkeyRoutes } from './routes/portkey.js';
import { DbPortkeyRepository } from './services/db-portkey-repository.js';
import {
  CreatePortkeyUseCase,
  DeletePortkeyUseCase,
  ListPortkeysUseCase,
  RecordHitUseCase,
  ResolvePortkeyUseCase,
  UpdatePortkeyUseCase,
} from './usecases/manage-portkeys.js';

/**
 * Portkey (PLAN-15): short, memorable LAN go-links — `bifrost.local/go/router`,
 * `/go/nas`, `/go/standup` → an instant 302. Slugs are user-chosen words (the
 * whole point over generated ids is memorability), redirects are always 302 (a
 * target moves; a 301 sticks in caches), and the hit count is bumped out of band
 * so a slow write never delays the hop.
 *
 * Local profile only, permanently — a go-links service reachable from the public
 * internet is a textbook open-redirect / phishing primitive. On the LAN it's a
 * convenience (targets are http(s)-only but may point at any host).
 */
export const portkeyModule: FeatureModule = {
  name: 'portkey',
  register(app, deps) {
    const { log, db, bus, sse } = deps;

    const repo = new DbPortkeyRepository(db);
    const recordHit = new RecordHitUseCase(repo, bus);

    // Hit accounting is deferred and best-effort: scheduled after the redirect
    // is flushed, guarded against running once shutdown has begun, and its
    // failure is a warn (a lost count is cosmetic — never a failed redirect).
    let stopped = false;
    const countHit = (slug: string): void => {
      if (stopped) return;
      setImmediate(() => {
        if (stopped) return;
        try {
          recordHit.execute(slug);
        } catch (error) {
          log.warn({ err: error, slug }, 'portkey: hit count write failed');
        }
      });
    };

    const unsubscribes = [
      bus.on('portkey.saved', (payload) => sse.broadcast('portkey.saved', payload)),
      bus.on('portkey.deleted', (payload) => sse.broadcast('portkey.deleted', payload)),
      bus.on('portkey.hit', (payload) => sse.broadcast('portkey.hit', payload)),
    ];

    app.addHook('onClose', () => {
      stopped = true;
      for (const off of unsubscribes) off();
    });

    registerPortkeyRoutes(app, {
      list: new ListPortkeysUseCase(repo),
      create: new CreatePortkeyUseCase(repo, bus),
      update: new UpdatePortkeyUseCase(repo, bus),
      remove: new DeletePortkeyUseCase(repo, bus),
      resolve: new ResolvePortkeyUseCase(repo),
      countHit,
    });
  },
};
