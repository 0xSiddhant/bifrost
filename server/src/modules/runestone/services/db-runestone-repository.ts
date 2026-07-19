import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { runestones } from '../../../core/db/schema.js';
import type { RunestoneSummary } from '../../../core/bus/events.js';
import type {
  RunestoneListFilter,
  RunestoneRecord,
  RunestoneRepository,
} from '../ports.js';

const SUMMARY_COLUMNS = {
  id: runestones.id,
  name: runestones.name,
  slug: runestones.slug,
  authorDeviceId: runestones.authorDeviceId,
  sizeBytes: runestones.sizeBytes,
  createdAt: runestones.createdAt,
  modifiedAt: runestones.modifiedAt,
};

/** `%`/`_` are LIKE wildcards — a search for "100%" must not match everything. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export class DbRunestoneRepository implements RunestoneRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  insert(record: RunestoneRecord): void {
    this.db.insert(runestones).values(record).run();
  }

  update(record: RunestoneRecord): void {
    this.db
      .update(runestones)
      .set({
        name: record.name,
        slug: record.slug,
        content: record.content,
        sizeBytes: record.sizeBytes,
        modifiedAt: record.modifiedAt,
      })
      .where(eq(runestones.id, record.id))
      .run();
  }

  findById(id: string): RunestoneRecord | null {
    return this.db.select().from(runestones).where(eq(runestones.id, id)).get() ?? null;
  }

  findBySlug(slug: string): RunestoneRecord | null {
    return this.db.select().from(runestones).where(eq(runestones.slug, slug)).get() ?? null;
  }

  list(filter: RunestoneListFilter): RunestoneSummary[] {
    const conditions: SQL[] = [];
    if (filter.q) {
      conditions.push(sql`${runestones.name} LIKE ${likePattern(filter.q)} ESCAPE '\\'`);
    }
    if (filter.authorDeviceId) {
      conditions.push(eq(runestones.authorDeviceId, filter.authorDeviceId));
    }

    const sortColumn = {
      name: sql`lower(${runestones.name})`,
      created: runestones.createdAt,
      modified: runestones.modifiedAt,
      size: runestones.sizeBytes,
    }[filter.sort];
    const direction = filter.order === 'asc' ? asc : desc;

    let query = this.db.select(SUMMARY_COLUMNS).from(runestones).$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    return query
      .orderBy(direction(sortColumn), asc(runestones.id))
      .limit(filter.limit)
      .offset(filter.offset)
      .all();
  }

  delete(id: string): RunestoneRecord | null {
    const record = this.findById(id);
    if (!record) return null;
    this.db.delete(runestones).where(eq(runestones.id, id)).run();
    return record;
  }

  listNames(): string[] {
    return this.db
      .select({ name: runestones.name })
      .from(runestones)
      .all()
      .map((row) => row.name);
  }

  hasId(id: string): boolean {
    return this.findById(id) !== null;
  }
}
