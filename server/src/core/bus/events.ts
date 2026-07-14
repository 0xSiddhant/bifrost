/**
 * One source of truth for cross-module event names and payloads.
 * Feature plans extend this map (dot-namespaced: `file.uploaded`,
 * `download.added`, `clipboard.updated`, ...).
 */

/** One entry of the downloads listing — also the SSE payload for download.* events. */
export interface DownloadEntry {
  /** Opaque id derived by the server; the only handle clients may use to fetch content. */
  id: string;
  name: string;
  /** Bytes. */
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
  /** Lowercased extension including the dot, or '' when the name has none. */
  ext: string;
}

export interface FileUploadedEvent {
  /** Name as supplied by the client, pre-sanitization. */
  originalName: string;
  /** Final `<timestamp>-<sanitized>` name inside uploads/. */
  storedName: string;
  /** Bytes. */
  size: number;
  /** Epoch milliseconds. */
  uploadedAt: number;
}

export interface BifrostEventMap {
  'file.uploaded': FileUploadedEvent;
  'download.added': DownloadEntry;
  'download.changed': DownloadEntry;
  'download.removed': DownloadEntry;
}

export type BifrostEventName = keyof BifrostEventMap;
