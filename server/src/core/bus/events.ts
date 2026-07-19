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

/** A shared-clipboard entry — the list/SSE payload shape (PLAN-06). */
export interface ClipboardEntry {
  id: string;
  text: string;
  kind: 'text' | 'code';
  lang: string | null;
  /** Stable id of the posting device, resolved to a name client-side via presence. */
  deviceId: string | null;
  createdAt: number;
}

/** Delta broadcast on any clipboard change — clients apply it without a refetch. */
export type ClipboardChange =
  | { action: 'add'; entry: ClipboardEntry }
  | { action: 'delete'; id: string };

/** A device as the presence dashboard shows it (PLAN-06). */
export interface PresenceDevice {
  deviceId: string;
  /** Friendly claimed name, or null. */
  name: string | null;
  /** Auto-assigned character alias ("Thor"); the default display name. */
  charName: string | null;
  /** UA-derived label, e.g. "iPhone · Safari" — shown alongside the alias in Heimdall only. */
  label: string;
  online: boolean;
  lastSeen: number;
}

/** A saved JSON document as the library lists it (PLAN-07 Part B). */
export interface RunestoneSummary {
  id: string;
  name: string;
  /** `<kebab-name>-<id>`; regenerates on rename, old id-links still resolve. */
  slug: string;
  /** PLAN-06 device id; display names resolve client-side via core/devices. */
  authorDeviceId: string | null;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

export interface BifrostEventMap {
  'file.uploaded': FileUploadedEvent;
  'download.added': DownloadEntry;
  'download.changed': DownloadEntry;
  'download.removed': DownloadEntry;
  'theme.updated': { themes: ThemeSummary[] };
  'settings.updated': SettingsUpdatedEvent;
  'clipboard.updated': ClipboardChange;
  'presence.changed': { devices: PresenceDevice[] };
  /** Emitted by Heimdall for the audit log; consumed only by audit-log. */
  'heimdall.login': { outcome: 'success' | 'failure' | 'locked'; ip: string };
  /** Create or update of a saved JSON document — libraries live-refresh from this. */
  'runestone.saved': { runestone: RunestoneSummary };
  'runestone.deleted': { id: string; name: string };
}

export type BifrostEventName = keyof BifrostEventMap;
