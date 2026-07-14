import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import pino from 'pino';
import { EventBus } from '../../../core/bus/index.js';
import type { Logger } from '../../../core/logger/index.js';
import { FileTooLargeError, type FileStorageRepository, type IncomingFile } from '../ports.js';
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

function makeUseCase(repo: FileStorageRepository, bus = new EventBus()) {
  return new UploadFilesUseCase({
    repo,
    bus,
    log,
    maxBytes: 1024,
    blockedExtensions: ['.exe', '.bat'],
    now: () => 1_752_000_000_000,
  });
}

describe('UploadFilesUseCase', () => {
  it('accepts a clean file, publishes it timestamped-sanitized, and emits file.uploaded', async () => {
    const repo = repoMock();
    const bus = new EventBus();
    const emitted = vi.fn();
    bus.on('file.uploaded', emitted);

    const result = await makeUseCase(repo, bus).execute(toAsync([incoming('photo.jpg', 'abcd')]));

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual([
      { name: 'photo.jpg', storedName: '1752000000000-photo.jpg', size: 4 },
    ]);
    expect(repo.publish).toHaveBeenCalledWith('/tmp/fake', '1752000000000-photo.jpg');
    expect(emitted).toHaveBeenCalledWith({
      originalName: 'photo.jpg',
      storedName: '1752000000000-photo.jpg',
      size: 4,
      uploadedAt: 1_752_000_000_000,
    });
  });

  it('sanitizes hostile names before storing', async () => {
    const repo = repoMock();
    await makeUseCase(repo).execute(toAsync([incoming('../../evil.sh')]));
    expect(repo.publish).toHaveBeenCalledWith('/tmp/fake', '1752000000000-evil.sh');
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

async function* toAsync(files: IncomingFile[]): AsyncIterable<IncomingFile> {
  yield* files;
}
