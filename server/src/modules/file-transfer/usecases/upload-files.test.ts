import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import pino from 'pino';
import { EventBus } from '../../../core/bus/index.js';
import type { Logger } from '../../../core/logger/index.js';
import {
  FileTooLargeError,
  FolderConflictError,
  type FileStorageRepository,
  type FolderPublisher,
  type IncomingFile,
} from '../ports.js';
import { UploadFilesUseCase } from './upload-files.js';

const log: Logger = pino({ level: 'silent' });

function repoMock(overrides: Partial<FileStorageRepository> = {}): FileStorageRepository {
  return {
    writeTmp: vi.fn(async (stream: Readable) => {
      let bytes = 0;
      for await (const chunk of stream) bytes += (chunk as Buffer).length;
      return { tmpPath: '/tmp/fake', bytes };
    }),
    publish: vi.fn(async (_tmpPath: string, storedName: string) => storedName),
    discard: vi.fn(async () => {}),
    ...overrides,
  };
}

function incoming(name: string, content = 'data'): IncomingFile {
  return { name, stream: Readable.from([Buffer.from(content)]) };
}

function folderPublisherMock(overrides: Partial<FolderPublisher> = {}): FolderPublisher {
  return {
    publish: vi.fn(async (_tmpPath: string, folder: string, desiredName: string) => ({
      finalName: desiredName,
      folder,
    })),
    ...overrides,
  };
}

function makeUseCase(
  repo: FileStorageRepository,
  bus = new EventBus(),
  folderPublisher: FolderPublisher = folderPublisherMock(),
) {
  return new UploadFilesUseCase({
    repo,
    bus,
    log,
    maxBytes: 1024,
    blockedExtensions: ['.exe', '.bat'],
    folderPublisher,
    now: () => 1_752_000_000_000,
  });
}

describe('UploadFilesUseCase', () => {
  it('accepts a clean file, publishes it under its own name, and emits file.uploaded', async () => {
    const repo = repoMock();
    const bus = new EventBus();
    const emitted = vi.fn();
    bus.on('file.uploaded', emitted);

    const result = await makeUseCase(repo, bus).execute(toAsync([incoming('photo.jpg', 'abcd')]));

    expect(result.rejected).toEqual([]);
    // No timestamp prefix since PLAN-17b: the name a person chose is the name
    // that lands, and only a real collision changes it (in `publish`).
    expect(result.accepted).toEqual([{ name: 'photo.jpg', storedName: 'photo.jpg', size: 4 }]);
    expect(repo.publish).toHaveBeenCalledWith('/tmp/fake', 'photo.jpg');
    expect(emitted).toHaveBeenCalledWith({
      originalName: 'photo.jpg',
      storedName: 'photo.jpg',
      size: 4,
      uploadedAt: 1_752_000_000_000,
    });
  });

  it('sanitizes hostile names before storing', async () => {
    const repo = repoMock();
    await makeUseCase(repo).execute(toAsync([incoming('../../evil.sh')]));
    expect(repo.publish).toHaveBeenCalledWith('/tmp/fake', 'evil.sh');
  });

  it('rejects blocklisted extensions without touching storage, draining the stream', async () => {
    const repo = repoMock();
    const file = incoming('malware.EXE');
    const resume = vi.spyOn(file.stream, 'resume');

    const result = await makeUseCase(repo).execute(toAsync([file]));

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ name: 'malware.EXE', reason: 'blocked-extension' }]);
    expect(repo.writeTmp).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalled();
  });

  it('maps FileTooLargeError to a too-large rejection', async () => {
    const repo = repoMock({
      writeTmp: vi.fn(async () => {
        throw new FileTooLargeError('too big');
      }),
    });

    const result = await makeUseCase(repo).execute(toAsync([incoming('big.bin')]));

    expect(result.rejected).toEqual([{ name: 'big.bin', reason: 'too-large' }]);
    expect(repo.publish).not.toHaveBeenCalled();
  });

  it('keeps processing later files after one fails mid-stream', async () => {
    let call = 0;
    const repo = repoMock({
      writeTmp: vi.fn(async (stream: Readable) => {
        call += 1;
        if (call === 1) throw new Error('disk hiccup');
        let bytes = 0;
        for await (const chunk of stream) bytes += (chunk as Buffer).length;
        return { tmpPath: '/tmp/fake-2', bytes };
      }),
    });

    const result = await makeUseCase(repo).execute(
      toAsync([incoming('flaky.bin'), incoming('fine.txt', 'ok')]),
    );

    expect(result.rejected).toEqual([{ name: 'flaky.bin', reason: 'upload-failed' }]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.name).toBe('fine.txt');
  });
});

describe('UploadFilesUseCase in folder mode (PLAN-24)', () => {
  it('skips uploads/ entirely and emits both file.uploaded and file.published', async () => {
    const repo = repoMock();
    const bus = new EventBus();
    const publisher = folderPublisherMock();
    const uploaded = vi.fn();
    const published = vi.fn();
    bus.on('file.uploaded', uploaded);
    bus.on('file.published', published);

    const result = await makeUseCase(repo, bus, publisher).execute(
      toAsync([incoming('a.jpg', 'abcd')]),
      { folder: 'Trip photos', originDeviceId: 'device-a' },
    );

    expect(result.accepted).toEqual([
      { name: 'a.jpg', storedName: 'a.jpg', size: 4, folder: 'Trip photos' },
    ]);
    expect(publisher.publish).toHaveBeenCalledWith('/tmp/fake', 'Trip photos', 'a.jpg');
    // Criterion 1: the staging path is never touched in folder mode.
    expect(repo.publish).not.toHaveBeenCalled();
    // The audit line still fires — the file *was* uploaded — and the banner
    // event carries the destination and the origin device.
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(published).toHaveBeenCalledWith({
      name: 'a.jpg',
      size: 4,
      publishedAt: 1_752_000_000_000,
      originDeviceId: 'device-a',
      folder: 'Trip photos',
    });
  });

  /** Criterion 4: silently sanitized, and the folder actually used is reported. */
  it('sanitizes the folder name silently and reports what it used', async () => {
    const publisher = folderPublisherMock();

    const result = await makeUseCase(repoMock(), new EventBus(), publisher).execute(
      toAsync([incoming('a.jpg')]),
      { folder: '../Trip photos' },
    );

    expect(publisher.publish).toHaveBeenCalledWith('/tmp/fake', 'Trip photos', 'a.jpg');
    expect(result.accepted[0]?.folder).toBe('Trip photos');
    expect(result.rejected).toEqual([]);
  });

  it('carries a null origin when the client sent no device header', async () => {
    const bus = new EventBus();
    const published = vi.fn();
    bus.on('file.published', published);

    await makeUseCase(repoMock(), bus).execute(toAsync([incoming('a.jpg')]), { folder: 'Box' });

    expect(published).toHaveBeenCalledWith(expect.objectContaining({ originDeviceId: null }));
  });

  /** Criterion 5: a destination that is really a file is its own rejection. */
  it('rejects every file with folder-conflict when the name is a file, not a folder', async () => {
    const bus = new EventBus();
    const published = vi.fn();
    bus.on('file.published', published);
    const publisher = folderPublisherMock({
      publish: vi.fn(async () => {
        throw new FolderConflictError('"Photos" is already a file, not a folder');
      }),
    });

    const result = await makeUseCase(repoMock(), bus, publisher).execute(
      toAsync([incoming('a.jpg'), incoming('b.jpg')]),
      { folder: 'Photos' },
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { name: 'a.jpg', reason: 'folder-conflict' },
      { name: 'b.jpg', reason: 'folder-conflict' },
    ]);
    expect(published).not.toHaveBeenCalled();
  });

  it('leaves the plain staging path byte-for-byte unchanged when no folder is chosen', async () => {
    const repo = repoMock();
    const publisher = folderPublisherMock();
    const bus = new EventBus();
    const published = vi.fn();
    bus.on('file.published', published);

    const result = await makeUseCase(repo, bus, publisher).execute(toAsync([incoming('a.jpg')]));

    expect(repo.publish).toHaveBeenCalledWith('/tmp/fake', 'a.jpg');
    expect(publisher.publish).not.toHaveBeenCalled();
    // No banner: a staged file is announced by Move, not by the upload.
    expect(published).not.toHaveBeenCalled();
    expect(result.accepted[0]).not.toHaveProperty('folder');
  });
});

async function* toAsync(files: IncomingFile[]): AsyncIterable<IncomingFile> {
  yield* files;
}
