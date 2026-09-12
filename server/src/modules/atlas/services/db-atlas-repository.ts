import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { atlasDocs } from '../../../core/db/schema.js';
import type { AtlasSummary } from '../../../core/bus/events.js';
import type { AtlasListFilter, AtlasRecord, AtlasRepository } from '../ports.js';

const SUMMARY_COLUMNS = {
  id: atlasDocs.id,
  name: atlasDocs.name,
  slug: atlasDocs.slug,
  authorDeviceId: atlasDocs.authorDeviceId,
  sizeBytes: atlasDocs.sizeBytes,
  createdAt: atlasDocs.createdAt,
  modifiedAt: atlasDocs.modifiedAt,
};

/** `%`/`_` are LIKE wildcards — a search for "100%" must not match everything. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export class DbAtlasRepository implements AtlasRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  insert(record: AtlasRecord): void {
    this.db.insert(atlasDocs).values(record).run();
  }

  update(record: AtlasRecord): void {
    this.db
      .update(atlasDocs)
      .set({
        name: record.name,
        slug: record.slug,
        content: record.content,
        sizeBytes: record.sizeBytes,
        modifiedAt: record.modifiedAt,
      })
      .where(eq(atlasDocs.id, record.id))
      .run();
  }

  findById(id: string): AtlasRecord | null {
    return this.db.select().from(atlasDocs).where(eq(atlasDocs.id, id)).get() ?? null;
  }

  findBySlug(slug: string): AtlasRecord | null {
    return this.db.select().from(atlasDocs).where(eq(atlasDocs.slug, slug)).get() ?? null;
  }

  list(filter: AtlasListFilter): AtlasSummary[] {
    const conditions: SQL[] = [];
    if (filter.q) {
      conditions.push(sql`${atlasDocs.name} LIKE ${likePattern(filter.q)} ESCAPE '\\'`);
    }
    if (filter.authorDeviceId) {
      conditions.push(eq(atlasDocs.authorDeviceId, filter.authorDeviceId));
    }

    const sortColumn = {
      name: sql`lower(${atlasDocs.name})`,
      created: atlasDocs.createdAt,
      modified: atlasDocs.modifiedAt,
      size: atlasDocs.sizeBytes,
    }[filter.sort];
    const direction = filter.order === 'asc' ? asc : desc;

    let query = this.db.select(SUMMARY_COLUMNS).from(atlasDocs).$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    return query
      .orderBy(direction(sortColumn), asc(atlasDocs.id))
      .limit(filter.limit)
      .offset(filter.offset)
      .all();
  }

  delete(id: string): AtlasRecord | null {
    const record = this.findById(id);
    if (!record) return null;
    this.db.delete(atlasDocs).where(eq(atlasDocs.id, id)).run();
    return record;
  }

  listNames(): string[] {
    return this.db
      .select({ name: atlasDocs.name })
      .from(atlasDocs)
      .all()
      .map((row) => row.name);
  }

  hasId(id: string): boolean {
    return this.findById(id) !== null;
  }
}
