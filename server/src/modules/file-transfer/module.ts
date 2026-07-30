import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { FeatureModule } from '../../core/module.js';
import { registerDownloadRoutes } from './routes/downloads.js';
import { registerFileRoutes } from './routes/files.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { DownloadWatcherService } from './services/download-watcher.js';
import { FsDownloadReader } from './services/fs-download-reader.js';
import { FsFileStorageRepository } from './services/fs-file-storage.js';
import { FsUploadsStore } from './services/fs-uploads-store.js';
import { sweepPublishedDuplicates } from './services/place-file.js';
import { GetDownloadStreamUseCase } from './usecases/get-download-stream.js';
import { ListDownloadsUseCase } from './usecases/list-downloads.js';
import { ManageUploadsUseCase } from './usecases/manage-uploads.js';
import { UploadFilesUseCase } from './usecases/upload-files.js';

export const fileTransferModule: FeatureModule = {
  name: 'file-transfer',
  async register(app, deps) {
    const { config, log, bus, sse } = deps;
    const maxUploadBytes = config.maxUploadSizeMb * 1024 * 1024;

    const storage = new FsFileStorageRepository(config.storage.tmp, config.storage.uploads);
    const reader = new FsDownloadReader(config.storage.downloads);
    const watcher = new DownloadWatcherService(config.storage.downloads, bus, log);

    const uploadFiles = new UploadFilesUseCase({
      repo: storage,
      bus,
      log,
      maxBytes: maxUploadBytes,
      blockedExtensions: config.uploadExtBlocklist,
    });
    const listDownloads = new ListDownloadsUseCase(watcher);
    const getDownloadStream = new GetDownloadStreamUseCase(watcher, reader, log);
    const manageUploads = new ManageUploadsUseCase({
      store: new FsUploadsStore(config.storage.uploads, config.storage.downloads, log),
      bus,
      log,
    });

    // Modules publish through the bus; each module decides which of its own
    // events fan out to browsers (architecture: sse-hub wiring).
    const unsubscribes = [
      // Banner only. The listing is `download.added`'s job alone — see the
      // event's own doc comment for why the two must not be merged.
      bus.on('file.published', (event) => sse.broadcast('file.published', event)),
      bus.on('download.added', (entry) => sse.broadcast('download.added', entry)),
      bus.on('download.changed', (entry) => sse.broadcast('download.changed', entry)),
      bus.on('download.removed', (entry) => sse.broadcast('download.removed', entry)),
    ];

    await app.register(multipart, {
      // The repository's byte counter is the real per-file cap; busboy's own
      // limit sits slightly above it as a backstop, without throwing, so the
      // usecase can answer with a structured per-file rejection.
      throwFileSizeLimit: false,
      limits: {
        fileSize: maxUploadBytes + 1024,
        files: config.maxFilesPerUpload,
      },
    });
    await app.register(rateLimit, { global: false });

    registerFileRoutes(app, {
      uploadFiles,
      maxUploadBytes,
      maxUploadSizeMb: config.maxUploadSizeMb,
      maxFilesPerUpload: config.maxFilesPerUpload,
      blockedExtensions: config.uploadExtBlocklist,
      rateLimitPerMinute: config.uploadRateLimitPerMin,
    });
    registerDownloadRoutes(app, { listDownloads, getDownloadStream });
    registerUploadRoutes(app, { manageUploads });

    // A move is link-then-unlink, so a crash between the two leaves the file
    // in both folders. Reconcile before the watcher scans, so the listing is
    // never built from a state the app has already decided is wrong.
    const swept = await sweepPublishedDuplicates(config.storage.uploads, config.storage.downloads);
    if (swept.length > 0) {
      log.warn({ files: swept }, 'swept uploads left behind by an interrupted move');
    }

    // Initial scan doubles as boot reconciliation — the listing is complete
    // before the server starts accepting traffic.
    await watcher.start();

    app.addHook('onClose', async () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      await watcher.stop();
    });
  },
};
