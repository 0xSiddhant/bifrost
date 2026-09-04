import type { Readable } from 'node:stream';
import { AppError } from '../../../core/http/index.js';
import type { Logger } from '../../../core/logger/index.js';
import type { DownloadReader, DownloadRegistry, FolderArchiver } from '../ports.js';

export interface FolderArchive {
  stream: Readable;
  /** What the browser saves it as — `Trip photos.zip`. */
  zipName: string;
}

/**
 * One folder → one zip (PLAN-24). The route only ever sees the stream and the
 * name: no absolute path and no `archiver` object leaves this layer, which is
 * what keeps the fs knowledge in services/ where rules/coding.md wants it.
 *
 * The file list is a **snapshot** taken at request time. A file that lands
 * mid-zip simply isn't in it, and one deleted mid-zip is logged and skipped by
 * the archiver — ordinary eventual consistency, not a race to guard against.
 */
export class ArchiveFolderUseCase {
  constructor(
    private readonly registry: DownloadRegistry,
    private readonly reader: DownloadReader,
    private readonly archiver: FolderArchiver,
    private readonly log: Logger,
  ) {}

  async execute(id: string): Promise<FolderArchive> {
    const entry = this.registry.resolveEntry(id);
    if (!entry) throw new AppError('folder not found', 404, 'NOT_FOUND');
    if (entry.type !== 'folder') {
      // A file id here is a wrong-shaped request, not a missing one — answered
      // plainly rather than coerced into an empty archive.
      throw new AppError('that download is a file, not a folder', 400, 'NOT_A_FOLDER');
    }

    let folderPath: string;
    try {
      folderPath = await this.reader.confineFolder(entry.name);
    } catch (error) {
      // The watcher listed this folder, so it should be there: a deletion and
      // a failed realpath check look identical to the client on purpose, and
      // this line is the only place they are told apart.
      this.log.warn(
        { err: error, id, folder: entry.name },
        'folder path check failed after listing',
      );
      throw new AppError('folder not found', 404, 'NOT_FOUND');
    }

    const files = this.registry
      .list()
      .filter((child) => child.type === 'file' && child.parent === entry.name)
      .map((child) => child.name);

    this.log.info({ folder: entry.name, files: files.length }, 'streaming a folder archive');
    // Zero children is a valid, empty zip rather than an error — nothing to
    // special-case, and "the folder is empty" is a true answer.
    return { stream: this.archiver.stream(folderPath, files), zipName: `${entry.name}.zip` };
  }
}
