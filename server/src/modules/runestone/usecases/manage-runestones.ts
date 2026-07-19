import type { EventBus } from '../../../core/bus/index.js';
import type { RunestoneSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import { uniqueRelicTitle } from '../../../core/relics/index.js';
import type {
  RunestoneListFilter,
  RunestoneRecord,
  RunestoneRepository,
  RunestoneSort,
} from '../ports.js';
import { idFromSlug, makeSlug, newRunestoneId } from '../slug.js';

const NAME_MAX = 80;

export interface RunestoneDeps {
  repo: RunestoneRepository;
  bus: EventBus;
  maxDocBytes: number;
  now?: () => number;
  rng?: () => number;
}

function summaryOf(record: RunestoneRecord): RunestoneSummary {
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

/** 422 for broken JSON, 413 past the cap — the same cap the editor shows. */
function checkContent(content: string, maxDocBytes: number): number {
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > maxDocBytes) {
    throw new AppError('document exceeds the size limit', 413, 'PAYLOAD_TOO_LARGE');
  }
  try {
    JSON.parse(content);
  } catch {
    throw new AppError('document is not valid JSON', 422, 'INVALID_JSON');
  }
  return sizeBytes;
}

export interface SaveRunestoneInput {
  name?: string;
  content: string;
  authorDeviceId: string | null;
}

export class SaveRunestoneUseCase {
  constructor(private readonly deps: RunestoneDeps) {}

  execute(input: SaveRunestoneInput): RunestoneRecord {
    const { repo, bus, maxDocBytes } = this.deps;
    const now = this.deps.now ?? Date.now;
    const rng = this.deps.rng ?? Math.random;

    const sizeBytes = checkContent(input.content, maxDocBytes);
    const name =
      input.name?.trim().slice(0, NAME_MAX) ||
      uniqueRelicTitle(new Set(repo.listNames()), rng);

    let id = newRunestoneId(rng);
    while (repo.hasId(id)) id = newRunestoneId(rng);

    const at = now();
    const record: RunestoneRecord = {
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
    bus.emit('runestone.saved', { runestone: summaryOf(record) });
    return record;
  }
}

export interface UpdateRunestoneInput {
  id: string;
  name?: string;
  content?: string;
}

export class UpdateRunestoneUseCase {
  constructor(private readonly deps: RunestoneDeps) {}

  execute(input: UpdateRunestoneInput): RunestoneRecord {
    const { repo, bus, maxDocBytes } = this.deps;
    const now = this.deps.now ?? Date.now;

    const existing = repo.findById(input.id);
    if (!existing) throw new AppError('runestone not found', 404, 'NOT_FOUND');

    const content = input.content ?? existing.content;
    const sizeBytes =
      input.content !== undefined ? checkContent(input.content, maxDocBytes) : existing.sizeBytes;

    const name = input.name?.trim().slice(0, NAME_MAX) || existing.name;
    // Rename regenerates the slug; the id inside it stays, so old links resolve.
    const slug = name === existing.name ? existing.slug : makeSlug(name, existing.id);

    const record: RunestoneRecord = {
      ...existing,
      name,
      slug,
      content,
      sizeBytes,
      modifiedAt: now(),
    };
    repo.update(record);
    bus.emit('runestone.saved', { runestone: summaryOf(record) });
    return record;
  }
}

export interface ResolvedRunestone {
  record: RunestoneRecord;
  /** False when the request used a stale-name slug — the route answers 301. */
  canonical: boolean;
}

export class GetRunestoneUseCase {
  constructor(private readonly repo: RunestoneRepository) {}

  execute(slug: string): ResolvedRunestone {
    const direct = this.repo.findBySlug(slug);
    if (direct) return { record: direct, canonical: true };

    const id = idFromSlug(slug);
    const byId = id ? this.repo.findById(id) : null;
    if (byId) return { record: byId, canonical: false };

    throw new AppError('runestone not found', 404, 'NOT_FOUND');
  }
}

export interface ListRunestonesInput {
  q?: string;
  author?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

const SORTS: readonly RunestoneSort[] = ['name', 'created', 'modified', 'size'];

export class ListRunestonesUseCase {
  constructor(private readonly repo: RunestoneRepository) {}

  execute(input: ListRunestonesInput): RunestoneSummary[] {
    const sort = SORTS.includes(input.sort as RunestoneSort)
      ? (input.sort as RunestoneSort)
      : 'modified';
    const order =
      input.order === 'asc' || input.order === 'desc'
        ? input.order
        : sort === 'name'
          ? 'asc'
          : 'desc';
    const filter: RunestoneListFilter = {
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

export class DeleteRunestoneUseCase {
  constructor(
    private readonly repo: RunestoneRepository,
    private readonly bus: EventBus,
  ) {}

  execute(id: string): void {
    const deleted = this.repo.delete(id);
    if (!deleted) throw new AppError('runestone not found', 404, 'NOT_FOUND');
    this.bus.emit('runestone.deleted', { id: deleted.id, name: deleted.name });
  }
}
