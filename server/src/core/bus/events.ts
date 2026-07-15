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
  /** Best-effort uploader identity (request IP) for the Heimdall metadata view; absent when unknown. */
  uploaderHint?: string;
}

/**
 * Runtime settings changed in Heimdall (PLAN-05). Broadcast so open clients
 * rebind the entry gesture without a reload.
 */
export interface SettingsUpdatedEvent {
  shortcut: string;
  tapCount: number;
}

/** One validated theme as the listing/SSE payload shows it. */
export interface ThemeSummary {
  id: string;
  name: string;
  mode: 'dark' | 'light';
  preview: { bg: string; accent: string };
  builtIn: boolean;
  /** Contrast lint findings — warn, never block (PLAN-04). */
  warnings: string[];
}

export interface BifrostEventMap {
  'file.uploaded': FileUploadedEvent;
  'download.added': DownloadEntry;
  'download.changed': DownloadEntry;
  'download.removed': DownloadEntry;
  'theme.updated': { themes: ThemeSummary[] };
  'settings.updated': SettingsUpdatedEvent;
}

export type BifrostEventName = keyof BifrostEventMap;
