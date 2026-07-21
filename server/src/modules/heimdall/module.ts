import type { FeatureModule } from '../../core/module.js';
import { writeSetting } from '../../core/db/index.js';
import { registerHeimdallRoutes } from './routes/heimdall.js';
import { registerObservabilityRoutes } from './routes/observability.js';
import { LoginThrottle } from './login-throttle.js';
import { DbSettingsRepository } from './services/db-settings-repository.js';
import { DbUploadAuditRepository } from './services/db-upload-audit-repository.js';
import { FsStatsReader } from './services/fs-stats-reader.js';
import { UploadAuditRecorder } from './services/upload-audit-recorder.js';
import { GetSettingsUseCase, UpdateSettingsUseCase } from './usecases/manage-settings.js';
import { GetStatsUseCase } from './usecases/get-stats.js';
import { ListUploadsUseCase } from './usecases/list-uploads.js';

/**
 * Heimdall — the hidden, PIN-protected admin panel. Auth itself is core
 * (registerAuth wires secure-session + the requireAdmin guard); this module
 * owns the login/settings/stats/uploads routes and the upload audit recorder.
 */
export const heimdallModule: FeatureModule = {
  name: 'heimdall',
  async register(app, deps) {
    const { config, log, db, bus, sse, auth, logTap, setLogLevel } = deps;

    const settingsRepo = new DbSettingsRepository(db);
    const auditRepo = new DbUploadAuditRepository(db);
    const statsReader = new FsStatsReader([
      { folder: 'uploads', dir: config.storage.uploads },
      { folder: 'downloads', dir: config.storage.downloads },
      { folder: 'logs', dir: config.storage.logs },
      { folder: 'data', dir: config.storage.data },
    ]);

    const defaults = {
      shortcut: config.heimdall.shortcut,
      tapCount: config.heimdall.tapCount,
      defaultThemeId: config.themes.defaultId,
    };
    const getSettings = new GetSettingsUseCase(settingsRepo, defaults);

    const recorder = new UploadAuditRecorder(auditRepo, config.storage.uploads, bus, log);
    recorder.start();

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
      getStats: new GetStatsUseCase(statsReader, auditRepo, () => {
        const online = new Set<string>();
        for (const conn of sse.liveConnections()) if (conn.deviceId) online.add(conn.deviceId);
        return online.size;
      }),
      listUploads: new ListUploadsUseCase(auditRepo),
    });

    registerObservabilityRoutes(app, {
      config,
      log,
      logTap,
      setLogLevel,
      persistLevel: (level) => writeSetting(db, 'log.level', level),
      auth,
    });

    app.addHook('onClose', () => {
      unsubscribe();
      recorder.stop();
    });
  },
};
