import { AppError } from '../../../core/http/index.js';
import { downloadIdFor } from '../../../core/download-id.js';
import type { DownloadEntry } from '../../../core/bus/events.js';
import type { Logger } from '../../../core/logger/index.js';
import type { DownloadDeleteSnapshot, DownloadReader, DownloadRegistry } from '../ports.js';
import { DownloadChangedError } from '../ports.js';

export class DeleteDownloadUseCase {
  constructor(
    private readonly registry: DownloadRegistry,
    private readonly reader: DownloadReader,
    private readonly log: Logger,
  ) {}

  async execute(id: string, snapshot: DownloadDeleteSnapshot): Promise<void> {
    // Verify the confirmed path against its id instead of requiring a watcher cache hit.
    const name = relativeName(snapshot);
    if (!name || downloadIdFor(name) !== id) throw notFound();

    const entry = this.registry.resolveEntry(id);
    if (entry && !sameEntry(entry, snapshot)) {
      throw changed();
    }

    if (entry?.type === 'folder') {
      const children = this.registry
        .list()
        .filter((candidate) => candidate.type === 'file' && candidate.parent === entry.name)
        .map(({ name: childName, size, mtime }) => ({ name: childName, size, mtime }));
      if (!sameChildren(children, snapshot.children)) throw changed();
    }

    const fallback: DownloadEntry = {
      id,
      name: snapshot.name,
      parent: snapshot.parent,
      ext: snapshot.ext,
      type: snapshot.type,
      size: snapshot.size,
      mtime: snapshot.mtime,
    };
    try {
      await this.reader.remove(name, snapshot.type, snapshot);
      this.registry.removeEntry(id, fallback);
      this.log.info({ id, name, type: snapshot.type }, 'download deleted');
    } catch (error) {
      this.log.warn({ err: error, id, name }, 'download deletion failed after listing');
      if (isCode(error, 'ENOENT')) {
        this.registry.removeEntry(id, fallback);
        throw notFound();
      }
      if (error instanceof DownloadChangedError) throw changed();
      if (isCode(error, 'ENOTEMPTY')) throw changed();
      if (isCode(error, 'EACCES') || isCode(error, 'EPERM')) {
        throw new AppError('the host is not permitted to remove this download', 500, 'DELETE_FAILED');
      }
      throw error;
    }
  }
}

function relativeName(snapshot: DownloadDeleteSnapshot): string | null {
  const validSegment = (segment: string) =>
    segment !== '' &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.startsWith('.') &&
    !segment.includes('/') &&
    !segment.includes('\\');

  if (!validSegment(snapshot.name)) return null;
  if (snapshot.parent !== null && !validSegment(snapshot.parent)) return null;
  if (snapshot.type === 'folder' && snapshot.parent !== null) return null;
  return snapshot.parent ? `${snapshot.parent}/${snapshot.name}` : snapshot.name;
}

function sameEntry(entry: DownloadEntry, snapshot: DownloadDeleteSnapshot): boolean {
  return (
    entry.name === snapshot.name &&
    entry.parent === snapshot.parent &&
    entry.ext === snapshot.ext &&
    entry.type === snapshot.type &&
    entry.size === snapshot.size &&
    entry.mtime === snapshot.mtime &&
    (entry.type !== 'file' || snapshot.children.length === 0)
  );
}

function sameChildren(
  left: DownloadDeleteSnapshot['children'],
  right: DownloadDeleteSnapshot['children'],
): boolean {
  if (left.length !== right.length) return false;
  const sortByName = (a: (typeof left)[number], b: (typeof left)[number]) =>
    a.name.localeCompare(b.name);
  const sortedLeft = [...left].sort(sortByName);
  const sortedRight = [...right].sort(sortByName);
  return sortedLeft.every(
    (child, index) =>
      child.name === sortedRight[index]?.name &&
      child.size === sortedRight[index]?.size &&
      child.mtime === sortedRight[index]?.mtime,
  );
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

function changed(): AppError {
  return new AppError(
    'the download or its contents changed; refresh the listing',
    409,
    'DOWNLOAD_CHANGED',
  );
}
