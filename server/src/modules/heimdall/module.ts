import type { FeatureModule } from '../../core/module.js';
import { registerHeimdallRoutes } from './routes/heimdall.js';
import { registerAboutRoutes } from './routes/about.js';
import { LoginThrottle } from './login-throttle.js';
import { DbSettingsRepository } from './services/db-settings-repository.js';
import { DbUploadStatsRepository } from './services/db-upload-stats-repository.js';
import { FsStatsReader } from './services/fs-stats-reader.js';
import { FsUploadFilesReader } from './services/fs-upload-files-reader.js';
import { GetSettingsUseCase, UpdateSettingsUseCase } from './usecases/manage-settings.js';
import { GetStatsUseCase } from './usecases/get-stats.js';
import { ListUploadFilesUseCase } from './usecases/list-upload-files.js';

/**
 * Heimdall — the hidden, PIN-protected admin panel. Auth itself is core
 * (registerAuth wires secure-session + the requireAdmin guard); this module
 * owns the login/settings/stats/uploads routes and the upload audit recorder.
 */
export const heimdallModule: FeatureModule = {
  name: 'heimdall',
  async register(app, deps) {
    const { config, log, db, bus, sse, auth } = deps;

    const settingsRepo = new DbSettingsRepository(db);
    const uploadStats = new DbUploadStatsRepository(db);
    const statsReader = new FsStatsReader(
      [
        { folder: 'uploads', dir: config.storage.uploads },
        { folder: 'downloads', dir: config.storage.downloads },
        { folder: 'logs', dir: config.storage.logs },
        { folder: 'data', dir: config.storage.data },
      ],
      log,
    );

    const defaults = {
      shortcut: config.heimdall.shortcut,
      tapCount: config.heimdall.tapCount,
      defaultThemeId: config.themes.defaultId,
    };
    const getSettings = new GetSettingsUseCase(settingsRepo, defaults);

    // Fan the shortcut/tap-count change out to open clients so they rebind.
    const unsubscribe = bus.on('settings.updated', (payload) =>
      sse.broadcast('settings.updated', payload),
    );

    registerHeimdallRoutes(app, {
      auth,
      throttle: new LoginThrottle(),
      bus,
      log,
      getSettings,
      updateSettings: new UpdateSettingsUseCase(settingsRepo, getSettings, bus),
      // "Devices connected" counts distinct online deviceIds, not raw SSE
      // connections — multiple tabs on one device must not inflate it, so this
      // matches the online count in the Wardens roster.
      getStats: new GetStatsUseCase(statsReader, uploadStats, () => {
        const online = new Set<string>();
        for (const conn of sse.liveConnections()) if (conn.deviceId) online.add(conn.deviceId);
        return online.size;
      }),
      listUploadFiles: new ListUploadFilesUseCase(
        new FsUploadFilesReader(config.storage.uploads, log),
      ),
    });

    registerAboutRoutes(app, { config });

    app.addHook('onClose', () => {
      unsubscribe();
    });
  },
};
