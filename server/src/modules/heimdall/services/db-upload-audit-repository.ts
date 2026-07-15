import { desc, gte, sql } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { uploadAudit } from '../../../core/db/schema.js';
import type { UploadAuditRepository, UploadRecord } from '../ports.js';

export class DbUploadAuditRepository implements UploadAuditRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  record(record: UploadRecord): void {
    this.db
      .insert(uploadAudit)
      .values(record)
      .onConflictDoUpdate({
        target: uploadAudit.storedName,
        set: {
          originalName: record.originalName,
          size: record.size,
          uploadedAt: record.uploadedAt,
          uploaderHint: record.uploaderHint,
        },
      })
      .run();
  }

  seed(record: UploadRecord): void {
    this.db.insert(uploadAudit).values(record).onConflictDoNothing().run();
  }

  page(limit: number, offset: number): { total: number; items: UploadRecord[] } {
    const totalRow = this.db.select({ count: sql<number>`count(*)` }).from(uploadAudit).get();
    const items = this.db
      .select()
      .from(uploadAudit)
      .orderBy(desc(uploadAudit.uploadedAt))
      .limit(limit)
      .offset(offset)
      .all();
    return { total: totalRow?.count ?? 0, items };
  }

  timestampsSince(sinceMs: number): number[] {
    return this.db
      .select({ uploadedAt: uploadAudit.uploadedAt })
      .from(uploadAudit)
      .where(gte(uploadAudit.uploadedAt, sinceMs))
      .all()
      .map((row) => row.uploadedAt);
  }
}
