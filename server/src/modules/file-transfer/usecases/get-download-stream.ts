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

  /** Name + current size, so the route can parse a Range header before streaming. */
  async resolve(id: string): Promise<{ name: string; size: number }> {
    const name = this.registry.resolveName(id);
    if (!name) throw notFound();
    try {
      const { size } = await this.reader.stat(name);
      return { name, size };
    } catch {
      throw notFound();
    }
  }

  async open(
    id: string,
    slice?: { start: number; end: number },
  ): Promise<DownloadContent & { name: string }> {
    const name = this.registry.resolveName(id);
    if (!name) throw notFound();
    try {
      const content = await this.reader.open(name, slice);
      return { ...content, name };
    } catch {
      // Deleted between listing and request, or the path check failed —
      // indistinguishable to the client on purpose.
      throw notFound();
    }
  }
}

function notFound(): AppError {
  return new AppError('file not found', 404, 'NOT_FOUND');
}
