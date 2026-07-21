import type { FeatureModule } from '../../core/module.js';
import { registerPresenceRoutes } from './routes/presence.js';
import { DbDeviceRepository } from './services/db-device-repository.js';
import {
  BuildPresenceUseCase,
  ClaimNameUseCase,
  PruneStaleDevicesUseCase,
  SyncPresenceUseCase,
} from './usecases/presence.js';

/**
 * Device presence (PLAN-06, local profile). Derived from the SSE hub — no
 * polling: every connect/disconnect records the device (deviceId + UA label)
 * and broadcasts a fresh `presence.changed`. Devices can claim a friendly name.
 */
export const presenceModule: FeatureModule = {
  name: 'presence',
  register(app, deps) {
    const { log, db, bus, sse } = deps;
    const repo = new DbDeviceRepository(db);
    const build = new BuildPresenceUseCase(repo, () => sse.liveConnections());
    const sync = new SyncPresenceUseCase(repo, () => sse.liveConnections(), build, bus);

    const unsubscribeBus = bus.on('presence.changed', (payload) =>
      sse.broadcast('presence.changed', payload),
    );
    const unsubscribeConn = sse.onConnectionChange(() => {
      try {
        sync.execute();
      } catch (error) {
        log.warn({ err: error }, 'presence sync failed');
      }
    });

    registerPresenceRoutes(app, {
      buildPresence: build,
      claimName: new ClaimNameUseCase(repo, build, bus),
      pruneStale: new PruneStaleDevicesUseCase(repo, () => sse.liveConnections(), build, bus),
    });

    app.addHook('onClose', () => {
      unsubscribeConn();
      unsubscribeBus();
    });
  },
};
