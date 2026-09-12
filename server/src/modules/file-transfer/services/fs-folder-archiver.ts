import path from 'node:path';
import type { Readable } from 'node:stream';
import { ZipArchive, type ArchiverError } from 'archiver';
import type { Logger } from '../../../core/logger/index.js';
import type { FolderArchiver } from '../ports.js';

/**
 * The only place `archiver` — and the filesystem knowledge a zip needs — is
 * imported (rules/coding.md: usecases and routes never touch fs). The archive
 * streams incrementally into the HTTP response: nothing is buffered whole, so
 * a folder of large media costs no more memory than a single file download.
 *
 * `core/backup` shells out to the `zip` CLI instead, and deliberately stays
 * that way: that one is a rare, whole-process, synchronous snapshot, whereas
 * this can be asked for by several devices at once, on demand.
 */
export class FsFolderArchiver implements FolderArchiver {
  constructor(private readonly log: Logger) {}

  stream(folderPath: string, files: string[]): Readable {
    const archive = new ZipArchive({ zlib: { level: 6 } });

    // A file deleted between the listing and its read arrives here (ENOENT).
    // The rest of the archive is still worth having, so this logs and carries
    // on rather than failing the whole download.
    archive.on('warning', (error: ArchiverError) => {
      this.log.warn({ err: error, folder: folderPath }, 'skipped an entry while zipping a folder');
    });
    // The archive IS the response stream, so its own 'error' event already
    // aborts the download; this is the line that says why, afterwards.
    archive.on('error', (error: ArchiverError) => {
      this.log.error({ err: error, folder: folderPath }, 'folder zip failed mid-stream');
    });

    for (const name of files) {
      // Never archive.directory(): the explicit per-file list is what keeps a
      // two-levels-deep Finder addition, which the watcher never indexed, from
      // silently riding along into the zip.
      archive.file(path.join(folderPath, name), { name });
    }

    // finalize() rejects with the same error the 'error' handler above already
    // logged, so this catch is deliberately silent — its only job is to stop a
    // duplicate becoming an unhandled rejection.
    archive.finalize().catch(() => {});
    return archive;
  }
}
