import path from 'node:path';
import type { EventBus } from '../../../core/bus/index.js';
import type { Logger } from '../../../core/logger/index.js';
import {
  FileTooLargeError,
  FolderConflictError,
  type FileStorageRepository,
  type FolderPublisher,
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
  /** Only used when the caller names a folder destination (PLAN-24). */
  folderPublisher?: FolderPublisher;
  /** Injectable for deterministic stored names in tests. */
  now?: () => number;
}

export interface UploadContext {
  uploaderHint?: string;
  /**
   * Folder destination. When set, the files skip uploads/ staging entirely and
   * land live in downloads/<folder>/ — no card, no Move, and no undo.
   */
  folder?: string;
  /** Whose browser stays quiet for the banner; null when the client sent none. */
  originDeviceId?: string | null;
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
    context: UploadContext = {},
  ): Promise<UploadResult> {
    const { repo, bus, log, maxBytes, blockedExtensions, folderPublisher } = this.deps;
    const now = this.deps.now ?? Date.now;
    const result: UploadResult = { accepted: [], rejected: [] };

    // Decided once: every file in one request shares the destination. The name
    // is sanitized silently and reported back in `accepted[].folder` — the same
    // treatment a *filename* already gets, not the rename rule's 422, because a
    // folder typed into the destination picker is an upload detail rather than
    // a name someone deliberately chose for a specific file.
    let destination: { folder: string; publisher: FolderPublisher } | null = null;
    if (context.folder !== undefined) {
      if (!folderPublisher) {
        // Wiring bug, never a user error — module.ts always injects one.
        // Failing loudly beats quietly staging the files in uploads/ instead.
        throw new Error('a folder destination needs a FolderPublisher');
      }
      destination = { folder: sanitizeFilename(context.folder), publisher: folderPublisher };
    }

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
        // No timestamp prefix (PLAN-17b): the name a person chose is the name
        // that lands, and only a *real* collision changes it.
        const storedName = destination
          ? (await destination.publisher.publish(written.tmpPath, destination.folder, safeName))
              .finalName
          : await repo.publish(written.tmpPath, safeName);

        result.accepted.push({
          name: file.name,
          storedName,
          size: written.bytes,
          ...(destination ? { folder: destination.folder } : {}),
        });
        bus.emit('file.uploaded', {
          originalName: file.name,
          storedName,
          size: written.bytes,
          uploadedAt: now(),
          uploaderHint: context.uploaderHint,
        });
        if (destination) {
          // A folder upload has no Move to announce it, so the banner event is
          // emitted here instead — the same event, carrying the folder. The
          // *listing* still comes from the watcher's download.added alone.
          bus.emit('file.published', {
            name: storedName,
            size: written.bytes,
            publishedAt: now(),
            originDeviceId: context.originDeviceId ?? null,
            folder: destination.folder,
          });
        }
        log.info(
          {
            file: storedName,
            bytes: written.bytes,
            ...(destination && { folder: destination.folder }),
          },
          'upload accepted',
        );
      } catch (error) {
        if (error instanceof FileTooLargeError) {
          result.rejected.push({ name: file.name, reason: 'too-large' });
          log.info({ file: safeName, maxBytes }, 'upload rejected: too large');
        } else if (error instanceof FolderConflictError) {
          // Every file in this request shares the destination, so this will
          // repeat for each — the route turns an all-conflict batch into a 409.
          result.rejected.push({ name: file.name, reason: 'folder-conflict' });
          log.warn(
            { file: safeName, folder: destination?.folder },
            'upload rejected: destination is a file, not a folder',
          );
        } else {
          result.rejected.push({ name: file.name, reason: 'upload-failed' });
          log.warn({ file: safeName, err: error }, 'upload failed mid-stream');
        }
      }
    }

    return result;
  }
}
