import { DOWNLOAD_ID_PATTERN } from '../../core/download-id.js';
import type { FeatureModule } from '../../core/module.js';
import { FsDownloadInspector } from './services/fs-download-inspector.js';
import { GetPreviewMetaUseCase } from './usecases/get-preview-meta.js';

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: DOWNLOAD_ID_PATTERN },
  },
} as const;

export const previewsModule: FeatureModule = {
  name: 'previews',
  register(app, deps) {
    const getPreviewMeta = new GetPreviewMetaUseCase(
      new FsDownloadInspector(deps.config.storage.downloads),
    );

    app.get<{ Params: { id: string } }>(
      '/api/downloads/:id/meta',
      { schema: { params: idParamsSchema } },
      (request) => getPreviewMeta.execute(request.params.id),
    );
  },
};
