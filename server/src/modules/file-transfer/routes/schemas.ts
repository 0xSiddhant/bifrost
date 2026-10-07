import { errorResponseSchema, errorResponses, rawBody } from '../../../core/http/schemas.js';

/**
 * file-transfer's response shapes (PLAN-32). Properties follow the order the
 * watcher and usecases build each object: the serializer writes schema order,
 * and the contract guard holds every response to the handler's exact bytes.
 */

export const TAGS = ['file-transfer'];

export const downloadEntrySchema = {
  type: 'object',
  required: ['id', 'name', 'size', 'mtime', 'ext', 'type', 'parent'],
  properties: {
    id: { type: 'string', description: 'Opaque, derived from the path inside downloads/' },
    name: { type: 'string', description: 'Base name, never folder-qualified' },
    size: { type: 'integer', description: 'Bytes; 0 for a folder' },
    mtime: { type: 'integer', description: 'Unix epoch milliseconds' },
    ext: { type: 'string', description: "Lowercased, with the dot; '' for none or a folder" },
    type: { type: 'string', enum: ['file', 'folder'] },
    parent: {
      type: ['string', 'null'],
      description: 'The folder it lives in, or null at the root',
    },
  },
} as const;

export const uploadResultSchema = {
  type: 'object',
  required: ['accepted', 'rejected'],
  properties: {
    accepted: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'storedName', 'size'],
        properties: {
          name: { type: 'string', description: 'As the client sent it' },
          storedName: { type: 'string', description: 'Sanitized, suffixed only on a collision' },
          size: { type: 'integer' },
          folder: { type: 'string', description: 'Folder uploads only: where it landed' },
        },
      },
    },
    rejected: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'reason'],
        properties: {
          name: { type: 'string' },
          reason: {
            type: 'string',
            enum: ['too-large', 'blocked-extension', 'upload-failed', 'folder-conflict'],
          },
        },
      },
    },
  },
} as const;

export const publishResultSchema = {
  type: 'object',
  required: ['finalName', 'renamed'],
  properties: {
    finalName: { type: 'string' },
    renamed: { type: 'boolean', description: 'A suffix was added because the name was taken' },
  },
} as const;

const fileHeaders = {
  'accept-ranges': { type: 'string', description: 'Always `bytes`' },
  'content-disposition': {
    type: 'string',
    description: '`inline` with `?inline=1`, otherwise `attachment`, with the file name',
  },
  'content-length': { type: 'integer' },
} as const;

/** A stored file streamed with range support (`respondWithFile`). */
export const fileContentResponses = {
  200: rawBody(
    'application/octet-stream',
    "The whole file. With `?inline=1` it carries its extension's type instead (HTML and SVG as text)",
    fileHeaders,
  ),
  206: rawBody('application/octet-stream', 'One byte range (`Range: bytes=…`)', {
    ...fileHeaders,
    'content-range': { type: 'string', description: '`bytes <start>-<end>/<size>`' },
  }),
  416: {
    ...errorResponses(416)[416],
    headers: { 'content-range': { type: 'string', description: '`bytes */<size>`' } },
  },
  ...errorResponses(400, 404),
} as const;

/**
 * 413 is either a refusal before streaming (the declared body or the file
 * count is over the cap) or the upload result itself when every file was
 * too large — the per-file reasons are what the client shows.
 */
export const uploadTooLargeResponse = {
  description: 'Over a cap: the refusal envelope, or the result when every file was too large',
  anyOf: [uploadResultSchema, errorResponseSchema],
} as const;
