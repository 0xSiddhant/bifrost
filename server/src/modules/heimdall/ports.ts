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

/**
 * Upload counts for the dashboard, read from `audit_events` (PLAN-17b).
 *
 * That table is conceptually the `audit-log` module's, and this is a
 * deliberate, visible coupling: modules may not import each other, but they do
 * share one database, and the alternative was keeping a second table whose
 * only remaining job was to say the same thing twice — and to say it wrongly
 * whenever a file was deleted outside the app.
 */
export interface UploadStatsRepository {
  /** Every upload ever recorded. */
  total(): number;
  /** Upload timestamps (epoch ms) at or after `sinceMs`, for counts + activity. */
  timestampsSince(sinceMs: number): number[];
}

/** One file currently sitting in uploads/ — read from the directory, not a table. */
export interface UploadFileEntry {
  name: string;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
}

export interface UploadFilesReader {
  list(): UploadFileEntry[];
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
