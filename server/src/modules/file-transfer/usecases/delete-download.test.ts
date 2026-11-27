import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../../../core/http/index.js';
import { downloadIdFor } from '../../../core/download-id.js';
import type { DownloadEntry } from '../../../core/bus/events.js';
import type { Logger } from '../../../core/logger/index.js';
import type { DownloadDeleteSnapshot, DownloadReader, DownloadRegistry } from '../ports.js';
import { DownloadChangedError } from '../ports.js';
import { FsDownloadReader } from '../services/fs-download-reader.js';
import { DeleteDownloadUseCase } from './delete-download.js';

const file: DownloadEntry = {
  id: downloadIdFor('Trip/report.txt'),
  name: 'report.txt',
  size: 12,
  mtime: 1,
  ext: '.txt',
  type: 'file',
  parent: 'Trip',
};

const folder: DownloadEntry = {
  id: downloadIdFor('Trip'),
  name: 'Trip',
  size: 0,
  mtime: 1,
  ext: '',
  type: 'folder',
  parent: null,
};

const fileSnapshot: DownloadDeleteSnapshot = {
  name: file.name,
  parent: file.parent,
  ext: file.ext,
  type: 'file',
  size: file.size,
  mtime: file.mtime,
  children: [],
};

const folderSnapshot: DownloadDeleteSnapshot = {
  name: folder.name,
  parent: folder.parent,
  ext: folder.ext,
  type: 'folder',
  size: folder.size,
  mtime: folder.mtime,
  children: [{ name: file.name, size: file.size, mtime: file.mtime }],
};

function subject(initialEntries: DownloadEntry[] = [file, folder]) {
  const entries = [...initialEntries];
  const registry: DownloadRegistry = {
    list: () => entries,
    resolveEntry: (id) => entries.find((entry) => entry.id === id) ?? null,
    removeEntry: vi.fn(),
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

  return { usecase: new DeleteDownloadUseCase(registry, reader, log), reader, registry, log };
}

describe('DeleteDownloadUseCase', () => {
  it('deletes a nested file using its registry-derived relative path', async () => {
    const { usecase, reader, registry, log } = subject();

    await usecase.execute(file.id, fileSnapshot);

    expect(reader.remove).toHaveBeenCalledWith('Trip/report.txt', 'file', fileSnapshot);
    expect(registry.removeEntry).toHaveBeenCalledWith(file.id, {
      ...file,
    });
    expect(log.info).toHaveBeenCalledWith(
      { id: file.id, name: 'Trip/report.txt', type: 'file' },
      'download deleted',
    );
  });

  it('passes folder type so the store removes the folder as one operation', async () => {
    const { usecase, reader } = subject();

    await usecase.execute(folder.id, folderSnapshot);

    expect(reader.remove).toHaveBeenCalledWith('Trip', 'folder', folderSnapshot);
  });

  it('deletes a file that is missing from the registry using its confirmed path', async () => {
    const { usecase, reader, registry } = subject([]);

    await usecase.execute(file.id, fileSnapshot);

    expect(reader.remove).toHaveBeenCalledWith('Trip/report.txt', 'file', fileSnapshot);
    expect(registry.removeEntry).toHaveBeenCalledWith(file.id, file);
  });

  it('deletes a confirmed file from disk when the registry missed its watcher event', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-delete-stale-'));
    const downloads = path.join(root, 'downloads');
    fs.mkdirSync(downloads);
    const filePath = path.join(downloads, 'IMG_0622.mov');
    fs.writeFileSync(filePath, 'video bytes');
    const stat = fs.statSync(filePath);
    const staleFile: DownloadEntry = {
      id: downloadIdFor('IMG_0622.mov'),
      name: 'IMG_0622.mov',
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
      ext: '.mov',
      type: 'file',
      parent: null,
    };
    const snapshot: DownloadDeleteSnapshot = {
      name: staleFile.name,
      parent: staleFile.parent,
      ext: staleFile.ext,
      type: staleFile.type,
      size: staleFile.size,
      mtime: staleFile.mtime,
      children: [],
    };
    const registry: DownloadRegistry = {
      list: () => [],
      resolveEntry: () => null,
      removeEntry: vi.fn(),
    };
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    try {
      await new DeleteDownloadUseCase(
        registry,
        new FsDownloadReader(downloads),
        log,
      ).execute(staleFile.id, snapshot);

      expect(fs.existsSync(filePath)).toBe(false);
      expect(registry.removeEntry).toHaveBeenCalledWith(staleFile.id, staleFile);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns 404 when the id does not match the confirmed path', async () => {
    const { usecase, reader } = subject();

    await expect(usecase.execute('missing', fileSnapshot)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(reader.remove).not.toHaveBeenCalled();
  });

  it('returns 404 when the indexed download disappeared before deletion', async () => {
    const { usecase, reader } = subject();
    vi.mocked(reader.remove).mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));

    await expect(usecase.execute(file.id, fileSnapshot)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('returns 409 rather than deleting an entry whose type changed', async () => {
    const { usecase, reader } = subject();
    vi.mocked(reader.remove).mockRejectedValueOnce(new DownloadChangedError());

    const operation = usecase.execute(file.id, fileSnapshot);
    await expect(operation).rejects.toBeInstanceOf(AppError);
    await expect(operation).rejects.toMatchObject({
      statusCode: 409,
      code: 'DOWNLOAD_CHANGED',
    });
  });

  it('maps a folder that becomes non-empty during removal to 409', async () => {
    const { usecase, reader } = subject();
    vi.mocked(reader.remove).mockRejectedValueOnce(
      Object.assign(new Error('directory not empty'), { code: 'ENOTEMPTY' }),
    );

    await expect(usecase.execute(folder.id, folderSnapshot)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DOWNLOAD_CHANGED',
    });
  });

  it('reports filesystem permission failures as a declared delete error', async () => {
    const { usecase, reader } = subject();
    vi.mocked(reader.remove).mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );

    await expect(usecase.execute(file.id, fileSnapshot)).rejects.toMatchObject({
      statusCode: 500,
      code: 'DELETE_FAILED',
    });
  });

  it('refuses a stale snapshot before touching the filesystem', async () => {
    const { usecase, reader } = subject();

    await expect(
      usecase.execute(file.id, { ...fileSnapshot, mtime: fileSnapshot.mtime + 1 }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DOWNLOAD_CHANGED' });
    expect(reader.remove).not.toHaveBeenCalled();
  });
});
