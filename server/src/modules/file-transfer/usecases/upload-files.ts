import path from 'node:path';
import type { EventBus } from '../../../core/bus/index.js';
import type { Logger } from '../../../core/logger/index.js';
import {
  FileTooLargeError,
  type FileStorageRepository,
  type IncomingFile,
  type UploadResult,
} from '../ports.js';
import { sanitizeFilename } from '../sanitize.js';

export interface UploadFilesDeps {
  repo: FileStorageRepository;
  bus: EventBus;
  log: Logger;
  maxBytes: number;
  blockedExtensions: readonly string[];
  /** Injectable for deterministic stored names in tests. */
  now?: () => number;
}

/**
 * Business rules for uploads: sanitize the name, enforce the extension
 * blocklist and per-file size cap, publish atomically, announce on the bus.
 * Rejections are per-file so the client can mark just the offending file.
 */
export class UploadFilesUseCase {
  constructor(private readonly deps: UploadFilesDeps) {}

  async execute(
    files: AsyncIterable<IncomingFile>,
    context: { uploaderHint?: string } = {},
  ): Promise<UploadResult> {
    const { repo, bus, log, maxBytes, blockedExtensions } = this.deps;
    const now = this.deps.now ?? Date.now;
    const result: UploadResult = { accepted: [], rejected: [] };

    for await (const file of files) {
      const safeName = sanitizeFilename(file.name);
      const ext = path.extname(safeName).toLowerCase();

      if (blockedExtensions.includes(ext)) {
        // The parser requires every part consumed — discard the bytes.
        file.stream.resume();
        result.rejected.push({ name: file.name, reason: 'blocked-extension' });
        log.info({ file: safeName }, 'upload rejected: blocked extension');
        continue;
      }

      try {
        const written = await repo.writeTmp(file.stream, maxBytes);
        const storedName = await repo.publish(written.tmpPath, `${now()}-${safeName}`);
        result.accepted.push({ name: file.name, storedName, size: written.bytes });
        bus.emit('file.uploaded', {
          originalName: file.name,
          storedName,
          size: written.bytes,
          uploadedAt: now(),
          uploaderHint: context.uploaderHint,
        });
        log.info({ file: storedName, bytes: written.bytes }, 'upload accepted');
      } catch (error) {
        if (error instanceof FileTooLargeError) {
          result.rejected.push({ name: file.name, reason: 'too-large' });
          log.info({ file: safeName, maxBytes }, 'upload rejected: too large');
        } else {
          result.rejected.push({ name: file.name, reason: 'upload-failed' });
          log.warn({ file: safeName, err: error }, 'upload failed mid-stream');
        }
      }
    }

    return result;
  }
}
