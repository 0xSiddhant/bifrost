import { AppError } from '../../../core/http/index.js';
import type { Logger } from '../../../core/logger/index.js';
import type { DownloadReader, DownloadRegistry } from '../ports.js';
import { DownloadTypeChangedError } from '../ports.js';

export class DeleteDownloadUseCase {
  constructor(
    private readonly registry: DownloadRegistry,
    private readonly reader: DownloadReader,
    private readonly log: Logger,
  ) {}

  async execute(id: string): Promise<void> {
    const entry = this.registry.resolveEntry(id);
    if (!entry) throw notFound();

    const name = entry.parent ? `${entry.parent}/${entry.name}` : entry.name;
    try {
      await this.reader.remove(name, entry.type);
      this.log.info({ id, name, type: entry.type }, 'download deleted');
    } catch (error) {
      this.log.warn({ err: error, id, name }, 'download deletion failed after listing');
      if (isCode(error, 'ENOENT')) throw notFound();
      if (error instanceof DownloadTypeChangedError) {
        throw new AppError('the download changed; refresh the listing', 409, 'DOWNLOAD_CHANGED');
      }
      throw error;
    }
  }
}

function isCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function notFound(): AppError {
  return new AppError('download not found', 404, 'NOT_FOUND');
}
