import type { UploadAuditRepository } from '../ports.js';

/** Upload metadata as the panel shows it — never a content handle. */
export interface UploadMetadata {
  name: string;
  size: number;
  uploadedAt: number;
  uploaderHint: string | null;
}

export interface UploadPage {
  total: number;
  items: UploadMetadata[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ListUploadsUseCase {
  constructor(private readonly audit: UploadAuditRepository) {}

  execute(limit = DEFAULT_LIMIT, offset = 0): UploadPage {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const boundedOffset = Math.max(Math.trunc(offset) || 0, 0);
    const { total, items } = this.audit.page(boundedLimit, boundedOffset);
    return {
      total,
      items: items.map((record) => ({
        name: record.originalName,
        size: record.size,
        uploadedAt: record.uploadedAt,
        uploaderHint: record.uploaderHint,
      })),
    };
  }
}
