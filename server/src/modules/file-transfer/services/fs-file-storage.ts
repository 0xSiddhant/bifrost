import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { FileTooLargeError, type FileStorageRepository, type TmpWrite } from '../ports.js';
import { placeFile } from './place-file.js';

/**
 * Uploads-side fs implementation: stream → private tmp file → atomic rename
 * into uploads/. A crash at any point leaves junk only in tmp/ (swept at
 * boot); nothing half-written is ever visible in uploads/.
 */
export class FsFileStorageRepository implements FileStorageRepository {
  constructor(
    private readonly tmpDir: string,
    private readonly uploadsDir: string,
  ) {}

  async writeTmp(stream: Readable, maxBytes: number): Promise<TmpWrite> {
    const tmpPath = path.join(this.tmpDir, randomUUID());
    let bytes = 0;
    let tooLarge = false;

    // Hard per-file byte counter (decision in PLAN-02): past the cap we stop
    // persisting but keep draining the part, so a multi-file request can
    // still answer with structured per-file rejections. Total request size
    // is bounded upstream by the content-length pre-check + rate limit.
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (tooLarge || bytes > maxBytes) {
          tooLarge = true;
          callback();
        } else {
          callback(null, chunk);
        }
      },
    });

    try {
      await pipeline(stream, counter, fs.createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 }));
    } catch (error) {
      await this.discard(tmpPath);
      throw error;
    }
    if (tooLarge) {
      await this.discard(tmpPath);
      throw new FileTooLargeError(`file exceeds ${maxBytes} bytes`);
    }
    return { tmpPath, bytes };
  }

  async publish(tmpPath: string, storedName: string): Promise<string> {
    // Names are no longer timestamp-prefixed (PLAN-17b), so collisions are
    // ordinary rather than rare — the shared helper is what makes them cheap
    // and bounded, and what keeps a crash from stranding a zero-byte file.
    const { finalName } = await placeFile(this.uploadsDir, tmpPath, storedName);
    const target = path.join(this.uploadsDir, finalName);
    // The link inherits the tmp file's private 0600; uploads are 0644.
    await fsp.chmod(target, 0o644);
    await this.discard(tmpPath);
    return finalName;
  }

  async discard(tmpPath: string): Promise<void> {
    await fsp.rm(tmpPath, { force: true });
  }
}
