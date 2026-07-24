import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { eddas } from '../../../core/db/schema.js';
import type { EddaSummary } from '../../../core/bus/events.js';
import type { EddaListFilter, EddaRecord, EddaRepository } from '../ports.js';

const SUMMARY_COLUMNS = {
  id: eddas.id,
  name: eddas.name,
  slug: eddas.slug,
  authorDeviceId: eddas.authorDeviceId,
  sizeBytes: eddas.sizeBytes,
  createdAt: eddas.createdAt,
  modifiedAt: eddas.modifiedAt,
};

/** `%`/`_` are LIKE wildcards — a search for "100%" must not match everything. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export class DbEddaRepository implements EddaRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  insert(record: EddaRecord): void {
    this.db.insert(eddas).values(record).run();
  }

  update(record: EddaRecord): void {
    this.db
      .update(eddas)
      .set({
        name: record.name,
        slug: record.slug,
        content: record.content,
        sizeBytes: record.sizeBytes,
        modifiedAt: record.modifiedAt,
      })
      .where(eq(eddas.id, record.id))
      .run();
  }

  findById(id: string): EddaRecord | null {
    return this.db.select().from(eddas).where(eq(eddas.id, id)).get() ?? null;
  }

  findBySlug(slug: string): EddaRecord | null {
    return this.db.select().from(eddas).where(eq(eddas.slug, slug)).get() ?? null;
  }

  list(filter: EddaListFilter): EddaSummary[] {
    const conditions: SQL[] = [];
    if (filter.q) {
      conditions.push(sql`${eddas.name} LIKE ${likePattern(filter.q)} ESCAPE '\\'`);
    }
    if (filter.authorDeviceId) {
      conditions.push(eq(eddas.authorDeviceId, filter.authorDeviceId));
    }

    const sortColumn = {
      name: sql`lower(${eddas.name})`,
      created: eddas.createdAt,
      modified: eddas.modifiedAt,
      size: eddas.sizeBytes,
    }[filter.sort];
    const direction = filter.order === 'asc' ? asc : desc;

    let query = this.db.select(SUMMARY_COLUMNS).from(eddas).$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    return query
      .orderBy(direction(sortColumn), asc(eddas.id))
      .limit(filter.limit)
      .offset(filter.offset)
      .all();
  }

  delete(id: string): EddaRecord | null {
    const record = this.findById(id);
    if (!record) return null;
    this.db.delete(eddas).where(eq(eddas.id, id)).run();
    return record;
  }

  listNames(): string[] {
    return this.db
      .select({ name: eddas.name })
      .from(eddas)
      .all()
      .map((row) => row.name);
  }

  hasId(id: string): boolean {
    return this.findById(id) !== null;
  }
}
