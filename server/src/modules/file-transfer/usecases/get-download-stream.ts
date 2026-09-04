import { AppError } from '../../../core/http/index.js';
import type { Logger } from '../../../core/logger/index.js';
import type { DownloadContent, DownloadReader, DownloadRegistry } from '../ports.js';

/** What the reader needs (a path relative to downloads/) and what the route shows. */
interface Target {
  /** `report.pdf` or `Trip/report.pdf` — the reader confines this. */
  path: string;
  /** Base name, which is what content-disposition should carry. */
  name: string;
}

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
    const target = this.locate(id);
    try {
      const { size } = await this.reader.stat(target.path);
      return { name: target.name, size };
    } catch (error) {
      // The watcher listed this file, so the client asked for something that
      // *should* exist: a plain deletion and a permissions/realpath problem
      // both surface as the same 404 to the user, and only this line tells
      // them apart afterwards.
      this.log.warn({ err: error, id, name: target.path }, 'download stat failed after listing');
      throw notFound();
    }
  }

  async open(
    id: string,
    slice?: { start: number; end: number },
  ): Promise<DownloadContent & { name: string }> {
    const target = this.locate(id);
    try {
      const content = await this.reader.open(target.path, slice);
      return { ...content, name: target.name };
    } catch (error) {
      // Deleted between listing and request, or the path check failed —
      // indistinguishable to the *client* on purpose. The log is the one place
      // where the two are told apart, so it must not be silent.
      this.log.warn({ err: error, id, name: target.path }, 'download open failed after listing');
      throw notFound();
    }
  }

  /**
   * A folder id asking for bytes is refused here, explicitly. It would 404
   * anyway — the reader's isFile() assertion throws and the catch above maps
   * it — but relying on an assertion in another layer to produce the right
   * error for a differently-shaped request is an accident, not a design.
   */
  private locate(id: string): Target {
    const entry = this.registry.resolveEntry(id);
    if (!entry || entry.type !== 'file') throw notFound();
    return {
      path: entry.parent ? `${entry.parent}/${entry.name}` : entry.name,
      name: entry.name,
    };
  }
}

function notFound(): AppError {
  return new AppError('file not found', 404, 'NOT_FOUND');
}
