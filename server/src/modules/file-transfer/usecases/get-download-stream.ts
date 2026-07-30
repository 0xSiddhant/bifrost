import { AppError } from '../../../core/http/index.js';
import type { Logger } from '../../../core/logger/index.js';
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
    private readonly log: Logger,
  ) {}

  /** Name + current size, so the route can parse a Range header before streaming. */
  async resolve(id: string): Promise<{ name: string; size: number }> {
    const name = this.registry.resolveName(id);
    if (!name) throw notFound();
    try {
      const { size } = await this.reader.stat(name);
      return { name, size };
    } catch (error) {
      // The watcher listed this file, so the client asked for something that
      // *should* exist: a plain deletion and a permissions/realpath problem
      // both surface as the same 404 to the user, and only this line tells
      // them apart afterwards.
      this.log.warn({ err: error, id, name }, 'download stat failed after listing');
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
    } catch (error) {
      // Deleted between listing and request, or the path check failed —
      // indistinguishable to the *client* on purpose. The log is the one place
      // where the two are told apart, so it must not be silent.
      this.log.warn({ err: error, id, name }, 'download open failed after listing');
      throw notFound();
    }
  }
}

function notFound(): AppError {
  return new AppError('file not found', 404, 'NOT_FOUND');
}
