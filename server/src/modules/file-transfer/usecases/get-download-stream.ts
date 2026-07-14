import { AppError } from '../../../core/http/index.js';
import type { DownloadContent, DownloadReader, DownloadRegistry } from '../ports.js';

/**
 * Ids come from the server's own listing — a client can only ever reference
 * files the watcher has seen inside downloads/, which kills path traversal by
 * design. The reader's realpath check is defense in depth on top.
 */
export class GetDownloadStreamUseCase {
  constructor(
    private readonly registry: DownloadRegistry,
    private readonly reader: DownloadReader,
  ) {}

  async execute(id: string): Promise<DownloadContent & { name: string }> {
    const name = this.registry.resolveName(id);
    if (!name) throw new AppError('file not found', 404, 'NOT_FOUND');
    try {
      const content = await this.reader.open(name);
      return { ...content, name };
    } catch {
      // Deleted between listing and request, or the path check failed —
      // indistinguishable to the client on purpose.
      throw new AppError('file not found', 404, 'NOT_FOUND');
    }
  }
}
