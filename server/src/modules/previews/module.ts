import { DOWNLOAD_ID_PATTERN } from '../../core/download-id.js';
import type { FeatureModule } from '../../core/module.js';
import { FsDownloadInspector, FsFileInspector } from './services/fs-file-inspector.js';
import {
  GetDownloadPreviewMetaUseCase,
  GetPreviewMetaUseCase,
} from './usecases/get-preview-meta.js';

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: DOWNLOAD_ID_PATTERN },
  },
} as const;

/** Same shape as the uploads routes': one segment, no separators, no dot-files. */
const nameParamsSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[^./\\\\][^/\\\\]*$' },
  },
} as const;

export const previewsModule: FeatureModule = {
  name: 'previews',
  register(app, deps) {
    const downloadInspector = new FsDownloadInspector(deps.config.storage.downloads);
    const downloadMeta = new GetDownloadPreviewMetaUseCase(
      downloadInspector,
      new GetPreviewMetaUseCase(downloadInspector),
    );
    // PLAN-17b: a staged upload can be previewed before it is published.
    // Metadata for both folders is decided here (this module owns what a file
    // *is*); the bytes come from file-transfer, which owns the storage.
    const uploadMeta = new GetPreviewMetaUseCase(new FsFileInspector(deps.config.storage.uploads));

    app.get<{ Params: { id: string } }>(
      '/api/downloads/:id/meta',
      { schema: { params: idParamsSchema } },
      (request) => downloadMeta.execute(request.params.id),
    );

    app.get<{ Params: { name: string } }>(
      '/api/files/:name/preview',
      { schema: { params: nameParamsSchema } },
      (request) => uploadMeta.byName(request.params.name),
    );
  },
};
