import type { ClipboardEntry } from '../../core/bus/events.js';

/** A row as stored — the SSE/list entry plus its optional TTL. */
export interface StoredClipboardEntry extends ClipboardEntry {
  expiresAt: number | null;
}

/** Filesystem/DB access for the clipboard board — usecases never touch Drizzle. */
export interface ClipboardRepository {
  insert(entry: StoredClipboardEntry): void;
  /** Non-expired entries, newest first. */
  list(now: number): ClipboardEntry[];
  /** Removes one entry; returns whether it existed. */
  delete(id: string): boolean;
  /**
   * Drop expired entries and any beyond the newest `max` (oldest-out).
   * Returns the removed ids so the caller can broadcast deletions.
   */
  prune(max: number, now: number): string[];
}
