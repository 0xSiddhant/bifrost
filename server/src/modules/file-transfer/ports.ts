import type { Readable } from 'node:stream';
import type { DownloadEntry } from '../../core/bus/events.js';

/** One file as it arrives from the multipart parser (HTTP concerns stay in the route). */
export interface IncomingFile {
  name: string;
  stream: Readable;
}

export interface TmpWrite {
  tmpPath: string;
  bytes: number;
}

/**
 * Uploads-side storage. Usecases only ever see this interface — the fs
 * implementation is injected by module.ts (layering rule in architecture.md).
 */
export interface FileStorageRepository {
  /**
   * Stream to a private tmp file, counting bytes. Stops persisting the moment
   * the count exceeds maxBytes and rejects with FileTooLargeError (the tmp
   * file is already discarded when it rejects).
   */
  writeTmp(stream: Readable, maxBytes: number): Promise<TmpWrite>;
  /** Atomic rename into uploads/, mode 0644. Returns the final (de-duplicated) name. */
  publish(tmpPath: string, storedName: string): Promise<string>;
  discard(tmpPath: string): Promise<void>;
}

/** Downloads-side listing state, owned by the watcher. */
export interface DownloadRegistry {
  list(): DownloadEntry[];
  /** id → current filename, or null when unknown. Ids only exist for watched files. */
  resolveName(id: string): string | null;
}

export interface DownloadContent {
  stream: Readable;
  size: number;
}

/** Downloads-side file access; implementation enforces the realpath prefix check. */
export interface DownloadReader {
  open(name: string): Promise<DownloadContent>;
}

export class FileTooLargeError extends Error {
  override name = 'FileTooLargeError';
}

export type UploadRejectionReason = 'too-large' | 'blocked-extension' | 'upload-failed';

export interface UploadResult {
  accepted: { name: string; storedName: string; size: number }[];
  rejected: { name: string; reason: UploadRejectionReason }[];
}
