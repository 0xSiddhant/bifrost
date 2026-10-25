import { and, asc, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
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

/** The filters every read shares — the list, its paged form, and the count. */
function whereFor(filter: Pick<AtlasListFilter, 'q' | 'authorDeviceId'>): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.q) {
    conditions.push(sql`${atlasDocs.name} LIKE ${likePattern(filter.q)} ESCAPE '\\'`);
  }
  if (filter.authorDeviceId) {
    conditions.push(eq(atlasDocs.authorDeviceId, filter.authorDeviceId));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
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
    return this.select(filter, asc(atlasDocs.id));
  }

  listPage(filter: AtlasListFilter): AtlasSummary[] {
    const direction = filter.order === 'asc' ? asc : desc;
    return this.select(filter, direction(atlasDocs.id));
  }

  count(filter: Pick<AtlasListFilter, 'q' | 'authorDeviceId'>): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(atlasDocs)
      .where(whereFor(filter))
      .get();
    return row?.n ?? 0;
  }

  listAuthors(): string[] {
    return this.db
      .selectDistinct({ id: atlasDocs.authorDeviceId })
      .from(atlasDocs)
      .where(isNotNull(atlasDocs.authorDeviceId))
      .orderBy(asc(atlasDocs.authorDeviceId))
      .all()
      .flatMap((row) => (row.id ? [row.id] : []));
  }

  private select(filter: AtlasListFilter, tiebreak: SQL): AtlasSummary[] {
    const sortColumn = {
      name: sql`lower(${atlasDocs.name})`,
      created: atlasDocs.createdAt,
      modified: atlasDocs.modifiedAt,
      size: atlasDocs.sizeBytes,
    }[filter.sort];
    const direction = filter.order === 'asc' ? asc : desc;

    return this.db
      .select(SUMMARY_COLUMNS)
      .from(atlasDocs)
      .where(whereFor(filter))
      .orderBy(direction(sortColumn), tiebreak)
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
