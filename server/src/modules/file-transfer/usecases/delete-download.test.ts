import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../core/http/index.js';
import type { DownloadEntry } from '../../../core/bus/events.js';
import type { Logger } from '../../../core/logger/index.js';
import type { DownloadReader, DownloadRegistry } from '../ports.js';
import { DownloadTypeChangedError } from '../ports.js';
import { DeleteDownloadUseCase } from './delete-download.js';

const file: DownloadEntry = {
  id: 'file-id',
  name: 'report.txt',
  size: 12,
  mtime: 1,
  ext: '.txt',
  type: 'file',
  parent: 'Trip',
};

const folder: DownloadEntry = {
  id: 'folder-id',
  name: 'Trip',
  size: 0,
  mtime: 1,
  ext: '',
  type: 'folder',
  parent: null,
};

function subject() {
  const entries = [file, folder];
  const registry: DownloadRegistry = {
    list: () => entries,
    resolveEntry: (id) => entries.find((entry) => entry.id === id) ?? null,
  };
  const reader: DownloadReader = {
    stat: vi.fn(async () => ({ size: 12 })),
    open: vi.fn(),
    confineFolder: vi.fn(),
    remove: vi.fn(async () => undefined),
  };
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  return { usecase: new DeleteDownloadUseCase(registry, reader, log), reader, log };
}

describe('DeleteDownloadUseCase', () => {
  it('deletes a nested file using its registry-derived relative path', async () => {
    const { usecase, reader, log } = subject();

    await usecase.execute(file.id);

    expect(reader.remove).toHaveBeenCalledWith('Trip/report.txt', 'file');
    expect(log.info).toHaveBeenCalledWith(
      { id: file.id, name: 'Trip/report.txt', type: 'file' },
      'download deleted',
    );
  });

  it('passes folder type so the store removes the folder as one operation', async () => {
    const { usecase, reader } = subject();

    await usecase.execute(folder.id);

    expect(reader.remove).toHaveBeenCalledWith('Trip', 'folder');
  });

  it('returns 404 for an id that is no longer in the listing', async () => {
    const { usecase, reader } = subject();

    await expect(usecase.execute('missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(reader.remove).not.toHaveBeenCalled();
  });

  it('returns 404 when the indexed download disappeared before deletion', async () => {
    const { usecase, reader } = subject();
    vi.mocked(reader.remove).mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));

    await expect(usecase.execute(file.id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('returns 409 rather than deleting an entry whose type changed', async () => {
    const { usecase, reader } = subject();
    vi.mocked(reader.remove).mockRejectedValueOnce(new DownloadTypeChangedError());

    const operation = usecase.execute(file.id);
    await expect(operation).rejects.toBeInstanceOf(AppError);
    await expect(operation).rejects.toMatchObject({ statusCode: 409, code: 'DOWNLOAD_CHANGED' });
  });
});
