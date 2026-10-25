import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { portkeys } from '../../../core/db/schema.js';
import type { Portkey, PortkeyListFilter, PortkeyPageFilter, PortkeyRepository } from '../ports.js';

/** `%`/`_` are LIKE wildcards — a search for "100%" must not match everything. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

interface PortkeyRow {
  slug: string;
  url: string;
  note: string | null;
  hits: number;
  authorDeviceId: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

const toPortkey = (row: PortkeyRow): Portkey => ({ ...row });

/** The search every read shares — the list, its paged form, and the count. */
function whereFor(filter: Pick<PortkeyListFilter, 'q'>): SQL | undefined {
  if (!filter.q) return undefined;
  const pattern = likePattern(filter.q);
  return or(
    sql`${portkeys.slug} LIKE ${pattern} ESCAPE '\\'`,
    sql`${portkeys.url} LIKE ${pattern} ESCAPE '\\'`,
    sql`${portkeys.note} LIKE ${pattern} ESCAPE '\\'`,
  );
}

export class DbPortkeyRepository implements PortkeyRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  insert(portkey: Portkey): void {
    this.db.insert(portkeys).values(portkey).run();
  }

  update(slug: string, patch: { url: string; note: string | null }): Portkey | null {
    this.db
      .update(portkeys)
      .set({ url: patch.url, note: patch.note })
      .where(eq(portkeys.slug, slug))
      .run();
    return this.findBySlug(slug);
  }

  findBySlug(slug: string): Portkey | null {
    const row = this.db.select().from(portkeys).where(eq(portkeys.slug, slug)).get();
    return row ? toPortkey(row) : null;
  }

  list(filter: PortkeyListFilter): Portkey[] {
    // Newest first; slug is the stable tiebreak so paging never repeats a row.
    return this.db
      .select()
      .from(portkeys)
      .where(whereFor(filter))
      .orderBy(desc(portkeys.createdAt), asc(portkeys.slug))
      .limit(filter.limit)
      .offset(filter.offset)
      .all()
      .map(toPortkey);
  }

  listPage(filter: PortkeyPageFilter): Portkey[] {
    const conditions: SQL[] = [];
    const base = whereFor(filter);
    if (base) conditions.push(base);
    if (filter.after) {
      conditions.push(
        sql`(${portkeys.createdAt}, ${portkeys.slug}) < (${filter.after.key}, ${filter.after.id})`,
      );
    }
    return this.db
      .select()
      .from(portkeys)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(portkeys.createdAt), desc(portkeys.slug))
      .limit(filter.limit)
      .all()
      .map(toPortkey);
  }

  count(filter: Pick<PortkeyListFilter, 'q'>): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(portkeys)
      .where(whereFor(filter))
      .get();
    return row?.n ?? 0;
  }

  delete(slug: string): Portkey | null {
    const existing = this.findBySlug(slug);
    if (!existing) return null;
    this.db.delete(portkeys).where(eq(portkeys.slug, slug)).run();
    return existing;
  }

  hasSlug(slug: string): boolean {
    return this.findBySlug(slug) !== null;
  }

  recordHit(slug: string, at: number): Portkey | null {
    this.db
      .update(portkeys)
      .set({ hits: sql`${portkeys.hits} + 1`, lastUsedAt: at })
      .where(eq(portkeys.slug, slug))
      .run();
    return this.findBySlug(slug);
  }
}
