import type { UploadFileEntry, UploadFilesReader } from '../ports.js';

export interface UploadFilesPage {
  total: number;
  items: UploadFileEntry[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * "What is on disk right now", newest first — deliberately *not* "what has
 * been sent", which is the History section's question and is answered by
 * `audit_events`. Before PLAN-17b one section tried to be both and drifted
 * into being neither: it listed screenshots deleted months earlier.
 */
export class ListUploadFilesUseCase {
  constructor(private readonly reader: UploadFilesReader) {}

  execute(limit = DEFAULT_LIMIT, offset = 0): UploadFilesPage {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const boundedOffset = Math.max(Math.trunc(offset) || 0, 0);
    const files = this.reader.list().sort((a, b) => b.mtime - a.mtime);
    return {
      total: files.length,
      items: files.slice(boundedOffset, boundedOffset + boundedLimit),
    };
  }
}
