import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import type { Logger } from '../../../core/logger/index.js';
import { accioLinks } from '../../../core/db/schema.js';
import type { AccioLink, AccioListFilter, AccioRepository } from '../ports.js';

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
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string');
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
      // so "js" never matches a row tagged "jsdoc".
      conditions.push(
        sql`EXISTS (SELECT 1 FROM json_each(${accioLinks.tags}) WHERE json_each.value = ${filter.tag})`,
      );
    }

    const sortColumn = {
      created: accioLinks.createdAt,
      // Untitled rows sort by their URL rather than clumping under NULL.
      title: sql`lower(coalesce(${accioLinks.title}, ${accioLinks.url}))`,
      url: sql`lower(${accioLinks.url})`,
    }[filter.sort];
    const direction = filter.order === 'asc' ? asc : desc;

    let query = this.db.select().from(accioLinks).$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    return query
      .orderBy(direction(sortColumn), asc(accioLinks.id))
      .limit(filter.limit)
      .offset(filter.offset)
      .all()
      .map((row) => toLink(row, this.log));
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
