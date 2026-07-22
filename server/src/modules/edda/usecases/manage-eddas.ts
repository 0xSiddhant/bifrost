import type { EventBus } from '../../../core/bus/index.js';
import type { EddaSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import { uniqueRelicTitle } from '../../../core/relics/index.js';
import type { EddaListFilter, EddaRecord, EddaRepository, EddaSort } from '../ports.js';
import { idFromSlug, isReservedSlug, makeSlug, newEddaId } from '../slug.js';

const NAME_MAX = 80;

export interface EddaDeps {
  repo: EddaRepository;
  bus: EventBus;
  maxDocBytes: number;
  now?: () => number;
  rng?: () => number;
}

function summaryOf(record: EddaRecord): EddaSummary {
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
 * 413 past the cap. Unlike Runestone there is no content validation — Markdown
 * is free text — so an empty document is fine and any bytes are accepted.
 */
function checkContent(content: string, maxDocBytes: number): number {
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > maxDocBytes) {
    throw new AppError('document exceeds the size limit', 413, 'PAYLOAD_TOO_LARGE');
  }
  return sizeBytes;
}

export interface SaveEddaInput {
  name?: string;
  content: string;
  authorDeviceId: string | null;
}

export class SaveEddaUseCase {
  constructor(private readonly deps: EddaDeps) {}

  execute(input: SaveEddaInput): EddaRecord {
    const { repo, bus, maxDocBytes } = this.deps;
    const now = this.deps.now ?? Date.now;
    const rng = this.deps.rng ?? Math.random;

    const sizeBytes = checkContent(input.content, maxDocBytes);
    const name =
      input.name?.trim().slice(0, NAME_MAX) || uniqueRelicTitle(new Set(repo.listNames()), rng);

    let id = newEddaId(rng);
    while (repo.hasId(id)) id = newEddaId(rng);

    const at = now();
    const record: EddaRecord = {
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
    bus.emit('edda.saved', { edda: summaryOf(record) });
    return record;
  }
}

export interface UpdateEddaInput {
  id: string;
  name?: string;
  content?: string;
}

export class UpdateEddaUseCase {
  constructor(private readonly deps: EddaDeps) {}

  execute(input: UpdateEddaInput): EddaRecord {
    const { repo, bus, maxDocBytes } = this.deps;
    const now = this.deps.now ?? Date.now;

    const existing = repo.findById(input.id);
    if (!existing) throw new AppError('edda not found', 404, 'NOT_FOUND');

    const content = input.content ?? existing.content;
    const sizeBytes =
      input.content !== undefined ? checkContent(input.content, maxDocBytes) : existing.sizeBytes;

    const name = input.name?.trim().slice(0, NAME_MAX) || existing.name;
    // Rename regenerates the slug; the id inside it stays, so old links resolve.
    const slug = name === existing.name ? existing.slug : makeSlug(name, existing.id);

    const record: EddaRecord = {
      ...existing,
      name,
      slug,
      content,
      sizeBytes,
      modifiedAt: now(),
    };
    repo.update(record);
    bus.emit('edda.saved', { edda: summaryOf(record) });
    return record;
  }
}

export interface ResolvedEdda {
  record: EddaRecord;
  /** False when the request used a stale-name slug — the route answers 301. */
  canonical: boolean;
}

export class GetEddaUseCase {
  constructor(private readonly repo: EddaRepository) {}

  execute(slug: string): ResolvedEdda {
    // A reserved bare segment is never a document — fail fast so it can't shadow
    // one of Edda's non-document surfaces.
    if (isReservedSlug(slug)) throw new AppError('edda not found', 404, 'NOT_FOUND');

    const direct = this.repo.findBySlug(slug);
    if (direct) return { record: direct, canonical: true };

    const id = idFromSlug(slug);
    const byId = id ? this.repo.findById(id) : null;
    if (byId) return { record: byId, canonical: false };

    throw new AppError('edda not found', 404, 'NOT_FOUND');
  }
}

export interface ListEddasInput {
  q?: string;
  author?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

const SORTS: readonly EddaSort[] = ['name', 'created', 'modified', 'size'];

export class ListEddasUseCase {
  constructor(private readonly repo: EddaRepository) {}

  execute(input: ListEddasInput): EddaSummary[] {
    const sort = SORTS.includes(input.sort as EddaSort) ? (input.sort as EddaSort) : 'modified';
    const order =
      input.order === 'asc' || input.order === 'desc'
        ? input.order
        : sort === 'name'
          ? 'asc'
          : 'desc';
    const filter: EddaListFilter = {
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

export class DeleteEddaUseCase {
  constructor(
    private readonly repo: EddaRepository,
    private readonly bus: EventBus,
  ) {}

  execute(id: string): void {
    const deleted = this.repo.delete(id);
    if (!deleted) throw new AppError('edda not found', 404, 'NOT_FOUND');
    this.bus.emit('edda.deleted', { id: deleted.id, name: deleted.name });
  }
}
