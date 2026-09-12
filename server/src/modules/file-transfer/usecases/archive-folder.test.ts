import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import pino from 'pino';
import type { DownloadEntry } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import type { Logger } from '../../../core/logger/index.js';
import type { DownloadReader, DownloadRegistry, FolderArchiver } from '../ports.js';
import { ArchiveFolderUseCase } from './archive-folder.js';

const log: Logger = pino({ level: 'silent' });

const entry = (over: Partial<DownloadEntry> & { id: string; name: string }): DownloadEntry => ({
  size: 1,
  mtime: 1,
  ext: '',
  type: 'file',
  parent: null,
  ...over,
});

const FOLDER = entry({ id: 'folder-1', name: 'Trip photos', type: 'folder' });
const LISTING: DownloadEntry[] = [
  FOLDER,
  entry({ id: 'a', name: 'a.jpg', parent: 'Trip photos', ext: '.jpg' }),
  entry({ id: 'b', name: 'b.jpg', parent: 'Trip photos', ext: '.jpg' }),
  entry({ id: 'root', name: 'loose.txt', ext: '.txt' }),
  entry({ id: 'other', name: 'x.jpg', parent: 'Другое', ext: '.jpg' }),
];

/**
 * Interfaces only — no real filesystem and no `archiver` anywhere in here,
 * which is the point of criterion 21: the usecase only ever handles a stream
 * and a name.
 */
function build(
  overrides: { list?: DownloadEntry[]; confineFolder?: DownloadReader['confineFolder'] } = {},
) {
  const list = overrides.list ?? LISTING;
  const registry: DownloadRegistry = {
    list: () => list,
    resolveEntry: (id) => list.find((e) => e.id === id) ?? null,
  };
  const reader: DownloadReader = {
    stat: vi.fn(),
    open: vi.fn(),
    confineFolder: overrides.confineFolder ?? vi.fn(async (name: string) => `/safe/${name}`),
  };
  const archiver: FolderArchiver = { stream: vi.fn(() => Readable.from(['zip'])) };
  return { usecase: new ArchiveFolderUseCase(registry, reader, archiver, log), reader, archiver };
}

describe('ArchiveFolderUseCase', () => {
  it('zips exactly that folder’s files, named as they sit inside it', async () => {
    const { usecase, archiver, reader } = build();

    const result = await usecase.execute('folder-1');

    expect(reader.confineFolder).toHaveBeenCalledWith('Trip photos');
    expect(archiver.stream).toHaveBeenCalledWith('/safe/Trip photos', ['a.jpg', 'b.jpg']);
    expect(result.zipName).toBe('Trip photos.zip');
  });

  it('404s an unknown id', async () => {
    const { usecase } = build();
    await expect(usecase.execute('nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  /** Criterion 13: a file id here is a clean 400, not a coerced empty zip. */
  it('400s an id that resolves to a file rather than a folder', async () => {
    const { usecase, archiver } = build();

    await expect(usecase.execute('root')).rejects.toMatchObject({
      statusCode: 400,
      code: 'NOT_A_FOLDER',
    });
    expect(archiver.stream).not.toHaveBeenCalled();
  });

  it('still resolves to a stream for an empty folder', async () => {
    const { usecase, archiver } = build({ list: [FOLDER] });

    const result = await usecase.execute('folder-1');

    expect(archiver.stream).toHaveBeenCalledWith('/safe/Trip photos', []);
    expect(result.stream).toBeInstanceOf(Readable);
  });

  /** Criterion 14: a path that fails the confinement check never streams. */
  it('404s when the folder path check fails, rather than surfacing the reason', async () => {
    const { usecase, archiver } = build({
      confineFolder: vi.fn(async () => {
        throw new Error('path escapes downloads/');
      }),
    });

    const error = await usecase.execute('folder-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 404 });
    expect(archiver.stream).not.toHaveBeenCalled();
  });
});
