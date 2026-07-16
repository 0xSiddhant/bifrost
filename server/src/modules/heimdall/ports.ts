/**
 * Repository/reader interfaces for Heimdall. Usecases depend on these, never on
 * Drizzle or fs directly (coding rule); concrete implementations live in
 * services/ and are injected by module.ts.
 */

/** Runtime settings Heimdall reads/edits. Values fall back to config defaults when unset in the DB. */
export interface HeimdallSettings {
  shortcut: string;
  tapCount: number;
  /** null = no explicit server default (clients follow prefers-color-scheme). */
  defaultThemeId: string | null;
}

export interface SettingsRepository {
  /** Overlay values present in the DB; missing keys come back undefined. */
  read(): Partial<HeimdallSettings>;
  /** Persist only the provided keys. */
  update(patch: Partial<HeimdallSettings>): void;
}

/** One upload's metadata — never its content (uploads have no read route). */
export interface UploadRecord {
  storedName: string;
  originalName: string;
  size: number;
  uploadedAt: number;
  uploaderHint: string | null;
}

export interface UploadAuditRepository {
  /** Upsert — live `file.uploaded` events carry the real uploader hint. */
  record(record: UploadRecord): void;
  /** Insert-or-ignore — boot reconciliation must not clobber a recorded hint. */
  seed(record: UploadRecord): void;
  page(limit: number, offset: number): { total: number; items: UploadRecord[] };
  /** Upload timestamps (epoch ms) at or after `sinceMs`, for counts + activity. */
  timestampsSince(sinceMs: number): number[];
}

/** Per-folder disk usage under storage/. */
export interface FolderUsage {
  folder: string;
  bytes: number;
  files: number;
}

export interface StatsReader {
  diskUsage(): FolderUsage[];
}
