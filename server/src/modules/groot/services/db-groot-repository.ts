import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { grootDocs } from '../../../core/db/schema.js';
import type { GrootSummary } from '../../../core/bus/events.js';
import type { GrootListFilter, GrootRecord, GrootRepository } from '../ports.js';

const SUMMARY_COLUMNS = {
  id: grootDocs.id,
  name: grootDocs.name,
  slug: grootDocs.slug,
  authorDeviceId: grootDocs.authorDeviceId,
  sizeBytes: grootDocs.sizeBytes,
  createdAt: grootDocs.createdAt,
  modifiedAt: grootDocs.modifiedAt,
};

/** `%`/`_` are LIKE wildcards — a search for "100%" must not match everything. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export class DbGrootRepository implements GrootRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  insert(record: GrootRecord): void {
    this.db.insert(grootDocs).values(record).run();
  }

  update(record: GrootRecord): void {
    this.db
      .update(grootDocs)
      .set({
        name: record.name,
        slug: record.slug,
        content: record.content,
        sizeBytes: record.sizeBytes,
        modifiedAt: record.modifiedAt,
      })
      .where(eq(grootDocs.id, record.id))
      .run();
  }

  findById(id: string): GrootRecord | null {
    return this.db.select().from(grootDocs).where(eq(grootDocs.id, id)).get() ?? null;
  }

  findBySlug(slug: string): GrootRecord | null {
    return this.db.select().from(grootDocs).where(eq(grootDocs.slug, slug)).get() ?? null;
  }

  list(filter: GrootListFilter): GrootSummary[] {
    const conditions: SQL[] = [];
    if (filter.q) {
      conditions.push(sql`${grootDocs.name} LIKE ${likePattern(filter.q)} ESCAPE '\\'`);
    }
    if (filter.authorDeviceId) {
      conditions.push(eq(grootDocs.authorDeviceId, filter.authorDeviceId));
    }

    const sortColumn = {
      name: sql`lower(${grootDocs.name})`,
      created: grootDocs.createdAt,
      modified: grootDocs.modifiedAt,
      size: grootDocs.sizeBytes,
    }[filter.sort];
    const direction = filter.order === 'asc' ? asc : desc;

    let query = this.db.select(SUMMARY_COLUMNS).from(grootDocs).$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    return query
      .orderBy(direction(sortColumn), asc(grootDocs.id))
      .limit(filter.limit)
      .offset(filter.offset)
      .all();
  }

  delete(id: string): GrootRecord | null {
    const record = this.findById(id);
    if (!record) return null;
    this.db.delete(grootDocs).where(eq(grootDocs.id, id)).run();
    return record;
  }

  listNames(): string[] {
    return this.db
      .select({ name: grootDocs.name })
      .from(grootDocs)
      .all()
      .map((row) => row.name);
  }

  hasId(id: string): boolean {
    return this.findById(id) !== null;
  }
}
