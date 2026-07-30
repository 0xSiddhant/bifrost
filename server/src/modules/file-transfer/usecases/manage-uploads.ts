import type { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import type { Logger } from '../../../core/logger/index.js';
import {
  UploadNotFoundError,
  type DownloadContent,
  type UploadFile,
  type UploadsStore,
} from '../ports.js';
import { sanitizeFilename } from '../sanitize.js';

export interface ManageUploadsDeps {
  store: UploadsStore;
  bus: EventBus;
  log: Logger;
  now?: () => number;
}

export interface PublishResult {
  finalName: string;
  /** True when downloads/ already held that name and a suffix was added. */
  renamed: boolean;
}

/**
 * Everything a sender can do to a file that is still in uploads/ (PLAN-17b).
 *
 * The four actions share one class because they share one hazard: **the UI
 * races them.** A card in a second tab, a double tap, or the back button can
 * ask to publish a file that has already been published or deleted. The rules
 * are therefore explicit rather than incidental — a missing source is 404, a
 * publish for a name already in flight is 409, and both are states the card
 * renders rather than crashes on.
 */
export class ManageUploadsUseCase {
  /** Names with a publish in flight — the whole reason 409 exists. */
  private readonly publishing = new Set<string>();

  constructor(private readonly deps: ManageUploadsDeps) {}

  /** Size + mtime, or 404 — the preview and the content route both start here. */
  async stat(name: string): Promise<UploadFile> {
    try {
      return await this.deps.store.stat(name);
    } catch (error) {
      throw this.asHttpError(error, name, 'stat');
    }
  }

  async open(name: string, slice?: { start: number; end: number }): Promise<DownloadContent> {
    try {
      return await this.deps.store.open(name, slice);
    } catch (error) {
      throw this.asHttpError(error, name, 'open');
    }
  }

  async publish(name: string, originDeviceId: string | null): Promise<PublishResult> {
    const { store, bus, log } = this.deps;
    const now = this.deps.now ?? Date.now;

    if (this.publishing.has(name)) {
      throw new AppError('this file is already being moved', 409, 'ALREADY_MOVING');
    }
    this.publishing.add(name);
    try {
      const { finalName, renamed, size } = await store.publish(name);
      // The banner rides this event; the Downloads *listing* still comes from
      // chokidar's `download.added` alone, or every published file would
      // announce itself twice (see the plan's ownership note).
      bus.emit('file.published', {
        name: finalName,
        size,
        publishedAt: now(),
        originDeviceId,
      });
      log.info({ file: finalName, renamed, size }, 'upload published to downloads');
      return { finalName, renamed };
    } catch (error) {
      throw this.asHttpError(error, name, 'publish');
    } finally {
      this.publishing.delete(name);
    }
  }

  async rename(name: string, requestedName: string): Promise<PublishResult> {
    const { store, log } = this.deps;
    if (this.publishing.has(name)) {
      throw new AppError('this file is being moved', 409, 'ALREADY_MOVING');
    }
    // Never silently alter a name someone typed: if the sanitizer would change
    // it, refuse and hand back what it *would* have used, so the UI can show
    // the real name before it becomes the file's name.
    const safeName = sanitizeFilename(requestedName);
    if (safeName !== requestedName) {
      throw new AppError(
        `that name can't be used as typed — it would be saved as "${safeName}"`,
        422,
        'BAD_NAME',
        { suggestion: safeName },
      );
    }
    try {
      const result = await store.rename(name, safeName);
      log.info({ from: name, to: result.finalName }, 'upload renamed');
      return result;
    } catch (error) {
      throw this.asHttpError(error, name, 'rename');
    }
  }

  async remove(name: string): Promise<void> {
    const { store, log } = this.deps;
    if (this.publishing.has(name)) {
      throw new AppError('this file is being moved', 409, 'ALREADY_MOVING');
    }
    try {
      await store.remove(name);
      log.info({ file: name }, 'upload deleted');
    } catch (error) {
      throw this.asHttpError(error, name, 'delete');
    }
  }

  /**
   * A vanished file is the *expected* end of a stale card's story, so it is a
   * plain 404 with no line. Anything else failed for a reason worth knowing —
   * a full disk, a permissions change — and would otherwise reach the user as
   * an opaque 500 and reach the archive as nothing at all.
   */
  private asHttpError(error: unknown, name: string, action: string): unknown {
    if (error instanceof UploadNotFoundError) {
      return new AppError('that file is no longer here', 404, 'NOT_FOUND');
    }
    if (error instanceof AppError) return error;
    this.deps.log.error({ err: error, file: name, action }, 'upload action failed');
    return error;
  }
}
