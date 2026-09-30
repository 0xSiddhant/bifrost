import type { EventBus } from '../../../core/bus/index.js';
import type { GrootSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import { pageLimit, type DocumentListPage, type PagingConfig } from '../../../core/paging.js';
import { uniqueRelicTitle } from '../../../core/relics/index.js';
import type { GrootListFilter, GrootRecord, GrootRepository, GrootSort } from '../ports.js';
import { idFromSlug, isReservedSlug, makeSlug, newGrootId } from '../slug.js';

const NAME_MAX = 80;

export interface GrootDeps {
  repo: GrootRepository;
  bus: EventBus;
  maxDocBytes: number;
  now?: () => number;
  rng?: () => number;
}

function summaryOf(record: GrootRecord): GrootSummary {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    authorDeviceId: record.authorDeviceId,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
    modifiedAt: record.modifiedAt,
  };
}

/**
 * 413 past the cap, and nothing else. **The server never parses YAML** — this
 * follows Edda, not Runestone. Two reasons: alias expansion is a billion-laughs
 * amplifier, so the byte cap would not bound a server-side parse at all; and
 * there is nothing to gain, because the client refuses to save a document it
 * cannot parse and a stored document is only ever handed back verbatim.
 *
 * The accepted consequence is that a client POSTing directly could store
 * syntactically invalid YAML and the raw endpoint would serve it back — exactly
 * what Edda already does with malformed Markdown.
 */
function checkContent(content: string, maxDocBytes: number): number {
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > maxDocBytes) {
    throw new AppError('document exceeds the size limit', 413, 'PAYLOAD_TOO_LARGE');
  }
  return sizeBytes;
}

export interface SaveGrootInput {
  name?: string;
  content: string;
  authorDeviceId: string | null;
}

export class SaveGrootUseCase {
  constructor(private readonly deps: GrootDeps) {}

  execute(input: SaveGrootInput): GrootRecord {
    const { repo, bus, maxDocBytes } = this.deps;
    const now = this.deps.now ?? Date.now;
    const rng = this.deps.rng ?? Math.random;

    const sizeBytes = checkContent(input.content, maxDocBytes);
    const name =
      input.name?.trim().slice(0, NAME_MAX) || uniqueRelicTitle(new Set(repo.listNames()), rng);

    let id = newGrootId(rng);
    while (repo.hasId(id)) id = newGrootId(rng);

    const at = now();
    const record: GrootRecord = {
      id,
      name,
      slug: makeSlug(name, id),
      content: input.content,
      authorDeviceId: input.authorDeviceId,
      sizeBytes,
      createdAt: at,
      modifiedAt: at,
    };
    repo.insert(record);
    bus.emit('groot.saved', { groot: summaryOf(record) });
    return record;
  }
}

export interface UpdateGrootInput {
  id: string;
  name?: string;
  content?: string;
}

export class UpdateGrootUseCase {
  constructor(private readonly deps: GrootDeps) {}

  execute(input: UpdateGrootInput): GrootRecord {
    const { repo, bus, maxDocBytes } = this.deps;
    const now = this.deps.now ?? Date.now;

    const existing = repo.findById(input.id);
    if (!existing) throw new AppError('document not found', 404, 'NOT_FOUND');

    const content = input.content ?? existing.content;
    const sizeBytes =
      input.content !== undefined ? checkContent(input.content, maxDocBytes) : existing.sizeBytes;

    const name = input.name?.trim().slice(0, NAME_MAX) || existing.name;
    // Rename regenerates the slug; the id inside it stays, so old links resolve.
    const slug = name === existing.name ? existing.slug : makeSlug(name, existing.id);

    const record: GrootRecord = {
      ...existing,
      name,
      slug,
      content,
      sizeBytes,
      modifiedAt: now(),
    };
    repo.update(record);
    bus.emit('groot.saved', { groot: summaryOf(record) });
    return record;
  }
}

export interface ResolvedGroot {
  record: GrootRecord;
  /** False when the request used a stale-name slug — the route answers 301. */
  canonical: boolean;
}

export class GetGrootUseCase {
  constructor(private readonly repo: GrootRepository) {}

  execute(slug: string): ResolvedGroot {
    // A reserved bare segment is never a document — fail fast so it can't shadow
    // one of Groot's non-document surfaces.
    if (isReservedSlug(slug)) throw new AppError('document not found', 404, 'NOT_FOUND');

    const direct = this.repo.findBySlug(slug);
    if (direct) return { record: direct, canonical: true };

    const id = idFromSlug(slug);
    const byId = id ? this.repo.findById(id) : null;
    if (byId) return { record: byId, canonical: false };

    throw new AppError('document not found', 404, 'NOT_FOUND');
  }
}

export interface ListGrootInput {
  q?: string;
  author?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

const SORTS: readonly GrootSort[] = ['name', 'created', 'modified', 'size'];

export class ListGrootUseCase {
  constructor(
    private readonly repo: GrootRepository,
    private readonly paging: PagingConfig,
  ) {}

  /** The legacy bare array — its 200/500 defaults are what installed clients rely on. */
  execute(input: ListGrootInput): GrootSummary[] {
    return this.repo.list(this.filterFor(input, Math.min(Math.max(input.limit ?? 200, 1), 500)));
  }

  /**
   * The paged form (PLAN-31): one page plus the total under the same filters
   * and the unfiltered author facet. Offset-based, because the Pensieve needs
   * random access to page k of a merge it computes itself.
   */
  executePage(input: ListGrootInput): DocumentListPage<GrootSummary> {
    const filter = this.filterFor(input, pageLimit(input.limit, this.paging));
    return {
      items: this.repo.listPage(filter),
      total: this.repo.count(filter),
      limit: filter.limit,
      offset: filter.offset,
      authors: this.repo.listAuthors(),
    };
  }

  private filterFor(input: ListGrootInput, limit: number): GrootListFilter {
    const sort = SORTS.includes(input.sort as GrootSort) ? (input.sort as GrootSort) : 'modified';
    const order =
      input.order === 'asc' || input.order === 'desc'
        ? input.order
        : sort === 'name'
          ? 'asc'
          : 'desc';
    return {
      q: input.q?.trim() || undefined,
      authorDeviceId: input.author || undefined,
      sort,
      order,
      limit,
      offset: Math.max(input.offset ?? 0, 0),
    };
  }
}

export class DeleteGrootUseCase {
  constructor(
    private readonly repo: GrootRepository,
    private readonly bus: EventBus,
  ) {}

  execute(id: string): void {
    const deleted = this.repo.delete(id);
    if (!deleted) throw new AppError('document not found', 404, 'NOT_FOUND');
    this.bus.emit('groot.deleted', { id: deleted.id, name: deleted.name });
  }
}
