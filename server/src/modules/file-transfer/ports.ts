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

/** One file sitting in uploads/, as the staging list shows it. */
export interface UploadFile {
  name: string;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
}

/**
 * Read/modify access to uploads/ — new in PLAN-17b, which deliberately
 * supersedes the "write-only, no read route" decision so a sender can preview,
 * rename, delete, or publish what they just sent. Every method resolves the
 * name inside uploads/ and refuses anything that escapes it.
 */
export interface UploadsStore {
  stat(name: string): Promise<UploadFile>;
  open(name: string, slice?: { start: number; end: number }): Promise<DownloadContent>;
  /** Rename within uploads/. Returns the final name (suffixed on collision). */
  rename(name: string, desiredName: string): Promise<{ finalName: string; renamed: boolean }>;
  remove(name: string): Promise<void>;
  /** Move into downloads/, disambiguating there. The upload is gone afterwards. */
  publish(name: string): Promise<{ finalName: string; renamed: boolean; size: number }>;
}

/** Thrown by the store when a name does not resolve to a file inside uploads/. */
export class UploadNotFoundError extends Error {
  override name = 'UploadNotFoundError';
}

/**
 * Places a brand-new tmp file into a folder under downloads/, creating that
 * folder if it isn't there yet (PLAN-24).
 *
 * Deliberately a third port rather than a method on FileStorageRepository
 * ("uploads-side storage") or UploadsStore (whose methods all take a name
 * already resident in uploads/): neither contract covers "a fresh tmp file
 * into a possibly-new folder under downloads/".
 */
export interface FolderPublisher {
  /**
   * Creates `folder` at the top level of downloads/ if missing, then hard-links
   * the tmp file into it under `desiredName`, deduping on collision via the
   * same placeFile() helper every other write uses. Rejects with
   * FolderConflictError if `folder` already names something that isn't a
   * directory. The tmp file is discarded either way.
   */
  publish(tmpPath: string, folder: string, desiredName: string): Promise<FolderPlacement>;
}

export interface FolderPlacement {
  /** The name actually used inside the folder — suffixed on a real collision. */
  finalName: string;
  /** The folder actually written to, which is what the client reports back. */
  folder: string;
}

/**
 * The destination name is already taken by a plain file, so it cannot also be
 * a directory. Mapped to a 409 rather than surfacing mkdir's opaque EEXIST.
 */
export class FolderConflictError extends Error {
  override name = 'FolderConflictError';
}

/** Downloads-side listing state, owned by the watcher. */
export interface DownloadRegistry {
  list(): DownloadEntry[];
  /**
   * id → the entry the watcher holds, or null when unknown. Richer than the
   * old `resolveName` because callers now need `type` (file or folder) and
   * `parent` (which folder a nested file lives in) as well as the name.
   */
  resolveEntry(id: string): DownloadEntry | null;
}

export interface DownloadContent {
  stream: Readable;
  size: number;
}

/**
 * Downloads-side file access; implementation enforces the realpath prefix
 * check. `name` is the path *relative to downloads/* — either `file.txt` or
 * `Folder/file.txt`, which the same prefix check already covers.
 */
export interface DownloadReader {
  stat(name: string): Promise<{ size: number }>;
  /**
   * `slice` (inclusive byte bounds) opens a partial stream for HTTP ranges;
   * `size` in the result is always the FULL file size either way.
   */
  open(name: string, slice?: { start: number; end: number }): Promise<DownloadContent>;
  /**
   * The same realpath-prefix check, asserting a directory: returns the safe
   * absolute path of a folder inside downloads/. Usecases never touch fs, so
   * this is how the archiver gets a path it is allowed to read.
   */
  confineFolder(name: string): Promise<string>;
}

/** Zips a folder's files into a stream. Owns the `archiver` dependency. */
export interface FolderArchiver {
  /**
   * `files` is an explicit list of base names inside `folderPath` — never a
   * whole-directory walk, so anything the watcher did not index (a file two
   * levels deep) cannot ride along into the archive.
   */
  stream(folderPath: string, files: string[]): Readable;
}

export class FileTooLargeError extends Error {
  override name = 'FileTooLargeError';
}

export type UploadRejectionReason =
  | 'too-large'
  | 'blocked-extension'
  | 'upload-failed'
  /** The chosen folder name is already a plain file on the host (PLAN-24). */
  | 'folder-conflict';

export interface UploadResult {
  accepted: {
    name: string;
    storedName: string;
    size: number;
    /**
     * Only in folder mode: the folder the file actually landed in. Present so
     * the client can tell the sender when sanitizing changed what they typed.
     */
    folder?: string;
  }[];
  rejected: { name: string; reason: UploadRejectionReason }[];
}
