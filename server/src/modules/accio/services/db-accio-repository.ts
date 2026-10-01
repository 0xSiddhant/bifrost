import { and, asc, desc, eq, getTableColumns, or, sql, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import type { Logger } from '../../../core/logger/index.js';
import { accioLinks } from '../../../core/db/schema.js';
import type { CursorKey } from '../../../core/paging.js';
import type {
  AccioLink,
  AccioListFilter,
  AccioPageFilter,
  AccioPageRow,
  AccioRepository,
} from '../ports.js';

/** `%`/`_` are LIKE wildcards — a search for "100%" must not match everything. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

interface LinkRow {
  id: string;
  url: string;
  title: string | null;
  tags: string;
  authorDeviceId: string | null;
  createdAt: number;
}

/** Tags live as a JSON array in one column; a corrupt value degrades to none. */
function toLink(row: LinkRow, log: Logger): AccioLink {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags);
    if (Array.isArray(parsed))
      tags = parsed.filter((tag): tag is string => typeof tag === 'string');
  } catch (error) {
    // A hand-edited DB shouldn't take the shelf down — show the link untagged.
    // But an unparseable tags column means a row was written by something other
    // than this code, and the only visible symptom is tags quietly disappearing
    // from one card, so it gets a line naming the row.
    log.warn({ err: error, id: row.id }, 'accio row has unparseable tags — showing it untagged');
  }
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    tags,
    authorDeviceId: row.authorDeviceId,
    createdAt: row.createdAt,
  };
}

/** The filters every read shares — the list, its paged form, and the count. */
function whereFor(filter: Pick<AccioListFilter, 'q' | 'tag'>): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.q) {
    const pattern = likePattern(filter.q);
    // Search spans title AND url so a half-remembered domain finds the row
    // even when the title never arrived.
    const match = or(
      sql`${accioLinks.title} LIKE ${pattern} ESCAPE '\\'`,
      sql`${accioLinks.url} LIKE ${pattern} ESCAPE '\\'`,
    );
    if (match) conditions.push(match);
  }
  if (filter.tag) {
    // Tags are a JSON array; match the exact element rather than a substring,
    // so "js" never matches a row tagged "jsdoc". A hand-corrupted value would
    // make json_each raise "malformed JSON" and fail the whole query, so it is
    // guarded — inside CASE, not AND, since SQLite may evaluate WHERE terms in
    // any order but evaluates CASE branches in order. Such a row then simply
    // matches no tag, which is how `toLink` already shows it: untagged.
    conditions.push(
      sql`CASE WHEN json_valid(${accioLinks.tags}) THEN EXISTS (SELECT 1 FROM json_each(${accioLinks.tags}) WHERE json_each.value = ${filter.tag}) ELSE 0 END`,
    );
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** The expression each sort orders by — and, in paged form, the cursor's key. */
function sortColumnFor(sort: AccioListFilter['sort']): SQL {
  return {
    created: sql`${accioLinks.createdAt}`,
    // Untitled rows sort by their URL rather than clumping under NULL.
    title: sql`lower(coalesce(${accioLinks.title}, ${accioLinks.url}))`,
    url: sql`lower(${accioLinks.url})`,
  }[sort];
}

export class DbAccioRepository implements AccioRepository {
  constructor(
    private readonly handle: DbHandle,
    private readonly log: Logger,
  ) {}

  private get db() {
    return this.handle.db;
  }

  insert(link: AccioLink): void {
    this.db
      .insert(accioLinks)
      .values({ ...link, tags: JSON.stringify(link.tags) })
      .run();
  }

  update(link: AccioLink): void {
    this.db
      .update(accioLinks)
      .set({ url: link.url, title: link.title, tags: JSON.stringify(link.tags) })
      .where(eq(accioLinks.id, link.id))
      .run();
  }

  findById(id: string): AccioLink | null {
    const row = this.db.select().from(accioLinks).where(eq(accioLinks.id, id)).get();
    return row ? toLink(row, this.log) : null;
  }

  list(filter: AccioListFilter): AccioLink[] {
    const direction = filter.order === 'asc' ? asc : desc;
    return this.db
      .select()
      .from(accioLinks)
      .where(whereFor(filter))
      .orderBy(direction(sortColumnFor(filter.sort)), asc(accioLinks.id))
      .limit(filter.limit)
      .offset(filter.offset)
      .all()
      .map((row) => toLink(row, this.log));
  }

  listPage(filter: AccioPageFilter): AccioPageRow[] {
    const sortColumn = sortColumnFor(filter.sort);
    const direction = filter.order === 'asc' ? asc : desc;
    const conditions: SQL[] = [];
    const base = whereFor(filter);
    if (base) conditions.push(base);
    if (filter.after) {
      // One row-value comparison (SQLite ≥ 3.15) — valid only because the
      // tiebreak runs in the same direction as the key.
      const op = sql.raw(filter.order === 'asc' ? '>' : '<');
      conditions.push(
        sql`(${sortColumn}, ${accioLinks.id}) ${op} (${filter.after.key}, ${filter.after.id})`,
      );
    }
    return this.db
      .select({ ...getTableColumns(accioLinks), sortKey: sql<CursorKey>`${sortColumn}` })
      .from(accioLinks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(direction(sortColumn), direction(accioLinks.id))
      .limit(filter.limit)
      .all()
      .map(({ sortKey, ...row }) => ({ link: toLink(row, this.log), key: sortKey }));
  }

  count(filter: Pick<AccioListFilter, 'q' | 'tag'>): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(accioLinks)
      .where(whereFor(filter))
      .get();
    return row?.n ?? 0;
  }

  listTags(): string[] {
    // `json_valid` keeps one hand-corrupted row from failing the whole facet —
    // `toLink` already shows such a row untagged, and this agrees with it.
    return this.db
      .all<{ tag: unknown }>(
        sql`SELECT DISTINCT json_each.value AS tag
            FROM ${accioLinks}, json_each(${accioLinks.tags})
            WHERE json_valid(${accioLinks.tags})
            ORDER BY 1`,
      )
      .flatMap((row) => (typeof row.tag === 'string' ? [row.tag] : []));
  }

  delete(id: string): AccioLink | null {
    const link = this.findById(id);
    if (!link) return null;
    this.db.delete(accioLinks).where(eq(accioLinks.id, id)).run();
    return link;
  }

  hasId(id: string): boolean {
    return this.findById(id) !== null;
  }
}
