import { and, asc, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
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

/** The filters every read shares — the list, its paged form, and the count. */
function whereFor(filter: Pick<EddaListFilter, 'q' | 'authorDeviceId'>): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.q) {
    conditions.push(sql`${eddas.name} LIKE ${likePattern(filter.q)} ESCAPE '\\'`);
  }
  if (filter.authorDeviceId) {
    conditions.push(eq(eddas.authorDeviceId, filter.authorDeviceId));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
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
    return this.select(filter, asc(eddas.id));
  }

  listPage(filter: EddaListFilter): EddaSummary[] {
    const direction = filter.order === 'asc' ? asc : desc;
    return this.select(filter, direction(eddas.id));
  }

  count(filter: Pick<EddaListFilter, 'q' | 'authorDeviceId'>): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(eddas)
      .where(whereFor(filter))
      .get();
    return row?.n ?? 0;
  }

  listAuthors(): string[] {
    return this.db
      .selectDistinct({ id: eddas.authorDeviceId })
      .from(eddas)
      .where(isNotNull(eddas.authorDeviceId))
      .orderBy(asc(eddas.authorDeviceId))
      .all()
      .flatMap((row) => (row.id ? [row.id] : []));
  }

  private select(filter: EddaListFilter, tiebreak: SQL): EddaSummary[] {
    const sortColumn = {
      name: sql`lower(${eddas.name})`,
      created: eddas.createdAt,
      modified: eddas.modifiedAt,
      size: eddas.sizeBytes,
    }[filter.sort];
    const direction = filter.order === 'asc' ? asc : desc;

    return this.db
      .select(SUMMARY_COLUMNS)
      .from(eddas)
      .where(whereFor(filter))
      .orderBy(direction(sortColumn), tiebreak)
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
