import type { EventBus } from '../../../core/bus/index.js';
import type { GrootSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
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
 * 413 past the cap, and **no YAML parsing at all** — this follows Edda, not
 * Runestone.
 *
 * Two reasons. Alias expansion is a billion-laughs amplifier, so a byte cap
 * does not bound a parse: a 3 KB document can expand to gigabytes, and the
 * server would be the one place with no way to refuse. And there is nothing to
 * gain — `/groot/api/:slug` promises the bytes that were saved, exactly as
 * Edda's markdown endpoint does, so a stored document only ever needs handing
 * back verbatim.
 *
 * Accepted consequence: a client POSTing directly could store YAML that does
 * not parse, and the raw endpoint would serve it back. The editor refuses to
 * save an unparseable document, which is where that check belongs.
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
    if (!existing) throw new AppError('groot not found', 404, 'NOT_FOUND');

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
    // one of Edda's non-document surfaces.
    if (isReservedSlug(slug)) throw new AppError('groot not found', 404, 'NOT_FOUND');

    const direct = this.repo.findBySlug(slug);
    if (direct) return { record: direct, canonical: true };

    const id = idFromSlug(slug);
    const byId = id ? this.repo.findById(id) : null;
    if (byId) return { record: byId, canonical: false };

    throw new AppError('groot not found', 404, 'NOT_FOUND');
  }
}

export interface ListGrootsInput {
  q?: string;
  author?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

const SORTS: readonly GrootSort[] = ['name', 'created', 'modified', 'size'];

export class ListGrootsUseCase {
  constructor(private readonly repo: GrootRepository) {}

  execute(input: ListGrootsInput): GrootSummary[] {
    const sort = SORTS.includes(input.sort as GrootSort) ? (input.sort as GrootSort) : 'modified';
    const order =
      input.order === 'asc' || input.order === 'desc'
        ? input.order
        : sort === 'name'
          ? 'asc'
          : 'desc';
    const filter: GrootListFilter = {
      q: input.q?.trim() || undefined,
      authorDeviceId: input.author || undefined,
      sort,
      order,
      limit: Math.min(Math.max(input.limit ?? 200, 1), 500),
      offset: Math.max(input.offset ?? 0, 0),
    };
    return this.repo.list(filter);
  }
}

export class DeleteGrootUseCase {
  constructor(
    private readonly repo: GrootRepository,
    private readonly bus: EventBus,
  ) {}

  execute(id: string): void {
    const deleted = this.repo.delete(id);
    if (!deleted) throw new AppError('groot not found', 404, 'NOT_FOUND');
    this.bus.emit('groot.deleted', { id: deleted.id, name: deleted.name });
  }
}
