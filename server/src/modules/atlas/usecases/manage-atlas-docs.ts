import type { EventBus } from '../../../core/bus/index.js';
import type { AtlasSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import { uniqueRelicTitle } from '../../../core/relics/index.js';
import type { AtlasListFilter, AtlasRecord, AtlasRepository, AtlasSort } from '../ports.js';
import { idFromSlug, isReservedSlug, makeSlug, newAtlasId } from '../slug.js';

const NAME_MAX = 80;

export interface AtlasDeps {
  repo: AtlasRepository;
  bus: EventBus;
  maxDocBytes: number;
  now?: () => number;
  rng?: () => number;
}

function summaryOf(record: AtlasRecord): AtlasSummary {
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
 * 413 past the cap, and nothing else. **The server never parses XML** — this
 * follows Edda and Groot, not Runestone.
 *
 * The reason is the same one Groot gives for YAML, and PLAN-23's spike measured
 * it: XML entity expansion is an amplifier, so a byte cap does not bound a
 * parse. What bounds it in the browser is the platform's own
 * entity-amplification guard, which a Node process running no browser engine
 * does not have — so a server-side parse would be the *one* place in this
 * feature without a limit. There is also nothing to gain: the client refuses to
 * save a document it cannot parse, and a stored document is only ever handed
 * back verbatim.
 *
 * The accepted consequence is that a client POSTing directly could store
 * malformed XML and the raw endpoint would serve it back — exactly what Edda
 * already does with malformed Markdown, and Groot with malformed YAML.
 */
function checkContent(content: string, maxDocBytes: number): number {
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > maxDocBytes) {
    throw new AppError('document exceeds the size limit', 413, 'PAYLOAD_TOO_LARGE');
  }
  return sizeBytes;
}

export interface SaveAtlasInput {
  name?: string;
  content: string;
  authorDeviceId: string | null;
}

export class SaveAtlasUseCase {
  constructor(private readonly deps: AtlasDeps) {}

  execute(input: SaveAtlasInput): AtlasRecord {
    const { repo, bus, maxDocBytes } = this.deps;
    const now = this.deps.now ?? Date.now;
    const rng = this.deps.rng ?? Math.random;

    const sizeBytes = checkContent(input.content, maxDocBytes);
    const name =
      input.name?.trim().slice(0, NAME_MAX) || uniqueRelicTitle(new Set(repo.listNames()), rng);

    let id = newAtlasId(rng);
    while (repo.hasId(id)) id = newAtlasId(rng);

    const at = now();
    const record: AtlasRecord = {
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
    bus.emit('atlas.saved', { atlas: summaryOf(record) });
    return record;
  }
}

export interface UpdateAtlasInput {
  id: string;
  name?: string;
  content?: string;
}

export class UpdateAtlasUseCase {
  constructor(private readonly deps: AtlasDeps) {}

  execute(input: UpdateAtlasInput): AtlasRecord {
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

    const record: AtlasRecord = {
      ...existing,
      name,
      slug,
      content,
      sizeBytes,
      modifiedAt: now(),
    };
    repo.update(record);
    bus.emit('atlas.saved', { atlas: summaryOf(record) });
    return record;
  }
}

export interface ResolvedAtlas {
  record: AtlasRecord;
  /** False when the request used a stale-name slug — the route answers 301. */
  canonical: boolean;
}

export class GetAtlasUseCase {
  constructor(private readonly repo: AtlasRepository) {}

  execute(slug: string): ResolvedAtlas {
    // A reserved bare segment is never a document — fail fast so it can't shadow
    // one of Atlas's non-document surfaces.
    if (isReservedSlug(slug)) throw new AppError('document not found', 404, 'NOT_FOUND');

    const direct = this.repo.findBySlug(slug);
    if (direct) return { record: direct, canonical: true };

    const id = idFromSlug(slug);
    const byId = id ? this.repo.findById(id) : null;
    if (byId) return { record: byId, canonical: false };

    throw new AppError('document not found', 404, 'NOT_FOUND');
  }
}

export interface ListAtlasInput {
  q?: string;
  author?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

const SORTS: readonly AtlasSort[] = ['name', 'created', 'modified', 'size'];

export class ListAtlasUseCase {
  constructor(private readonly repo: AtlasRepository) {}

  execute(input: ListAtlasInput): AtlasSummary[] {
    const sort = SORTS.includes(input.sort as AtlasSort) ? (input.sort as AtlasSort) : 'modified';
    const order =
      input.order === 'asc' || input.order === 'desc'
        ? input.order
        : sort === 'name'
          ? 'asc'
          : 'desc';
    const filter: AtlasListFilter = {
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

export class DeleteAtlasUseCase {
  constructor(
    private readonly repo: AtlasRepository,
    private readonly bus: EventBus,
  ) {}

  execute(id: string): void {
    const deleted = this.repo.delete(id);
    if (!deleted) throw new AppError('document not found', 404, 'NOT_FOUND');
    this.bus.emit('atlas.deleted', { id: deleted.id, name: deleted.name });
  }
}
