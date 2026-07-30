import { listFiles } from '../../../core/disk-usage.js';
import type { Logger } from '../../../core/logger/index.js';
import type { UploadFileEntry, UploadFilesReader } from '../ports.js';

/**
 * What is in uploads/ *right now*, from the one shared directory walker in
 * `core` — the same helper that produces the storage totals, so the listing
 * and the numbers can never disagree about which entries count (dot-files
 * count for neither).
 */
export class FsUploadFilesReader implements UploadFilesReader {
  constructor(
    private readonly uploadsDir: string,
    private readonly log: Logger,
  ) {}

  list(): UploadFileEntry[] {
    return listFiles(this.uploadsDir, this.log).map((entry) => ({
      name: entry.name,
      size: entry.bytes,
      mtime: entry.mtime,
    }));
  }
}
