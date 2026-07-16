import { and, desc, eq, gt, isNotNull, isNull, lte, notInArray, or } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { clipboardEntries } from '../../../core/db/schema.js';
import type { ClipboardEntry } from '../../../core/bus/events.js';
import type { ClipboardRepository, StoredClipboardEntry } from '../ports.js';

interface Row {
  id: string;
  text: string;
  kind: string;
  lang: string | null;
  deviceId: string | null;
  createdAt: number;
}

function toEntry(row: Row): ClipboardEntry {
  return {
    id: row.id,
    text: row.text,
    kind: row.kind === 'code' ? 'code' : 'text',
    lang: row.lang,
    deviceId: row.deviceId,
    createdAt: row.createdAt,
  };
}

export class DbClipboardRepository implements ClipboardRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  insert(entry: StoredClipboardEntry): void {
    this.db
      .insert(clipboardEntries)
      .values({
        id: entry.id,
        text: entry.text,
        kind: entry.kind,
        lang: entry.lang,
        deviceId: entry.deviceId,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      })
      .run();
  }

  list(now: number): ClipboardEntry[] {
    return this.db
      .select()
      .from(clipboardEntries)
      .where(or(isNull(clipboardEntries.expiresAt), gt(clipboardEntries.expiresAt, now)))
      .orderBy(desc(clipboardEntries.createdAt))
      .all()
      .map(toEntry);
  }

  delete(id: string): boolean {
    return this.db.delete(clipboardEntries).where(eq(clipboardEntries.id, id)).run().changes > 0;
  }

  prune(max: number, now: number): string[] {
    const removed: string[] = [];

    // Expired entries first.
    const expired = this.db
      .select({ id: clipboardEntries.id })
      .from(clipboardEntries)
      .where(and(isNotNull(clipboardEntries.expiresAt), lte(clipboardEntries.expiresAt, now)))
      .all();
    for (const { id } of expired) {
      this.db.delete(clipboardEntries).where(eq(clipboardEntries.id, id)).run();
      removed.push(id);
    }

    // Then anything past the newest `max` (oldest-out).
    const keep = this.db
      .select({ id: clipboardEntries.id })
      .from(clipboardEntries)
      .orderBy(desc(clipboardEntries.createdAt))
      .limit(max)
      .all()
      .map((row) => row.id);
    if (keep.length > 0) {
      const overflow = this.db
        .select({ id: clipboardEntries.id })
        .from(clipboardEntries)
        .where(notInArray(clipboardEntries.id, keep))
        .all();
      for (const { id } of overflow) {
        this.db.delete(clipboardEntries).where(eq(clipboardEntries.id, id)).run();
        removed.push(id);
      }
    }

    return removed;
  }
}
