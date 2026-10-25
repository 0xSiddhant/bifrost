import { DOWNLOAD_ID_PATTERN } from '../../core/download-id.js';
import { errorResponses } from '../../core/http/schemas.js';
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

/** `PreviewMeta`, in the order the usecase builds it. */
const previewMetaSchema = {
  type: 'object',
  required: ['previewable', 'kind', 'mime', 'name', 'size'],
  properties: {
    previewable: {
      type: 'boolean',
      description: 'False when the browser cannot show it, or it is too big',
    },
    kind: { type: 'string', enum: ['image', 'video', 'audio', 'pdf', 'markdown', 'text', 'none'] },
    mime: { type: 'string', description: 'Sniffed from the bytes first, then the extension' },
    name: { type: 'string', description: 'The base name, never folder-qualified' },
    size: { type: 'integer' },
  },
} as const;

const TAGS = ['previews'];

export const previewsModule: FeatureModule = {
  name: 'previews',
  register(app, deps) {
    const downloadInspector = new FsDownloadInspector(deps.config.storage.downloads, deps.log);
    const downloadMeta = new GetDownloadPreviewMetaUseCase(
      downloadInspector,
      new GetPreviewMetaUseCase(downloadInspector),
    );
    // PLAN-17b: a staged upload can be previewed before it is published.
    // Metadata for both folders is decided here (this module owns what a file
    // *is*); the bytes come from file-transfer, which owns the storage.
    const uploadMeta = new GetPreviewMetaUseCase(new FsFileInspector(deps.config.storage.uploads));

    app.get<{ Params: { id: string } }>(
      '/api/v1/downloads/:id/meta',
      {
        schema: {
          tags: TAGS,
          summary: 'What a download is, and whether the browser can preview it',
          operationId: 'getDownloadPreviewMeta',
          params: idParamsSchema,
          response: { 200: previewMetaSchema, ...errorResponses(400, 404) },
        },
      },
      (request) => downloadMeta.execute(request.params.id),
    );

    app.get<{ Params: { name: string } }>(
      '/api/v1/files/:name/preview',
      {
        schema: {
          tags: TAGS,
          summary: 'What a staged upload is, and whether the browser can preview it',
          operationId: 'getUploadPreviewMeta',
          params: nameParamsSchema,
          response: { 200: previewMetaSchema, ...errorResponses(400, 404) },
        },
      },
      (request) => uploadMeta.byName(request.params.name),
    );
  },
};
