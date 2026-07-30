import { and, eq, gte, sql } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { auditEvents } from '../../../core/db/schema.js';
import type { UploadStatsRepository } from '../ports.js';

/** The event name the `audit-log` recorder writes for an accepted upload. */
const UPLOAD_EVENT = 'file.uploaded';

/**
 * Upload counts straight from `audit_events` (PLAN-17b dropped `upload_audit`).
 *
 * The table belongs to the `audit-log` module conceptually; reading it from
 * here is a shared-database coupling, not a module import, and it is written
 * down rather than hidden because the honest alternative — a second table
 * recording the same events — is what this plan just removed.
 */
export class DbUploadStatsRepository implements UploadStatsRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  total(): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(auditEvents)
      .where(eq(auditEvents.event, UPLOAD_EVENT))
      .get();
    return row?.count ?? 0;
  }

  timestampsSince(sinceMs: number): number[] {
    return this.db
      .select({ ts: auditEvents.ts })
      .from(auditEvents)
      .where(and(eq(auditEvents.event, UPLOAD_EVENT), gte(auditEvents.ts, sinceMs)))
      .all()
      .map((row) => row.ts);
  }
}
