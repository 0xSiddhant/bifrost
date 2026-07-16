import { and, desc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { auditEvents } from '../../../core/db/schema.js';
import type { AuditQuery, AuditRecord, AuditRepository, NewAuditRecord } from '../ports.js';

export class DbAuditRepository implements AuditRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  append(record: NewAuditRecord): void {
    this.db.insert(auditEvents).values(record).run();
  }

  page(query: AuditQuery): { total: number; items: AuditRecord[] } {
    const filters: SQL[] = [];
    if (query.event) filters.push(eq(auditEvents.event, query.event));
    if (query.since !== undefined) filters.push(gte(auditEvents.ts, query.since));
    if (query.until !== undefined) filters.push(lte(auditEvents.ts, query.until));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const totalRow = this.db
      .select({ count: sql<number>`count(*)` })
      .from(auditEvents)
      .where(where)
      .get();
    const items = this.db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.ts), desc(auditEvents.id))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    return { total: totalRow?.count ?? 0, items };
  }

  distinctEvents(): string[] {
    return this.db
      .selectDistinct({ event: auditEvents.event })
      .from(auditEvents)
      .all()
      .map((row) => row.event);
  }

  pruneBefore(ts: number): number {
    return this.db.delete(auditEvents).where(lt(auditEvents.ts, ts)).run().changes;
  }
}
