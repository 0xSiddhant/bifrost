import type { EventBus } from '../../../core/bus/index.js';
import type { RunestoneSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import { pageLimit, type DocumentListPage, type PagingConfig } from '../../../core/paging.js';
import { uniqueRelicTitle } from '../../../core/relics/index.js';
import { isValidDocument } from '../format.js';
import type {
  RunestoneFormat,
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
    format: record.format,
  };
}

/**
 * 413 past the cap — the same cap the editor shows — then 422 for content that
 * is not valid in its format. One error code for both formats, so a client
 * that knows only strict JSON reads a JSONC refusal the way it always has.
 */
function checkContent(content: string, format: RunestoneFormat, maxDocBytes: number): number {
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > maxDocBytes) {
    throw new AppError('document exceeds the size limit', 413, 'PAYLOAD_TOO_LARGE');
  }
  if (!isValidDocument(content, format)) {
    throw new AppError(
      format === 'jsonc' ? 'document is not valid JSONC' : 'document is not valid JSON',
      422,
      'INVALID_JSON',
    );
  }
  return sizeBytes;
}

export interface SaveRunestoneInput {
  name?: string;
  content: string;
  /** Absent means strict JSON — what every client before PLAN-42 saved. */
  format?: RunestoneFormat;
  authorDeviceId: string | null;
}

export class SaveRunestoneUseCase {
  constructor(private readonly deps: RunestoneDeps) {}

  execute(input: SaveRunestoneInput): RunestoneRecord {
    const { repo, bus, maxDocBytes } = this.deps;
    const now = this.deps.now ?? Date.now;
    const rng = this.deps.rng ?? Math.random;

    const format = input.format ?? 'json';
    const sizeBytes = checkContent(input.content, format, maxDocBytes);
    const name =
      input.name?.trim().slice(0, NAME_MAX) || uniqueRelicTitle(new Set(repo.listNames()), rng);

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
      format,
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
  /** Absent keeps the stored format; a change is validated like new content. */
  format?: RunestoneFormat;
}

export class UpdateRunestoneUseCase {
  constructor(private readonly deps: RunestoneDeps) {}

  execute(input: UpdateRunestoneInput): RunestoneRecord {
    const { repo, bus, maxDocBytes } = this.deps;
    const now = this.deps.now ?? Date.now;

    const existing = repo.findById(input.id);
    if (!existing) throw new AppError('runestone not found', 404, 'NOT_FOUND');

    const content = input.content ?? existing.content;
    const format = input.format ?? existing.format;
    // The content is checked whenever it or the format it must be valid in
    // changes: switching a commented document to strict JSON is refused.
    const sizeBytes =
      input.content !== undefined || format !== existing.format
        ? checkContent(content, format, maxDocBytes)
        : existing.sizeBytes;

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
      format,
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
  format?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

const SORTS: readonly RunestoneSort[] = ['name', 'created', 'modified', 'size'];

export class ListRunestonesUseCase {
  constructor(
    private readonly repo: RunestoneRepository,
    private readonly paging: PagingConfig,
  ) {}

  /** The legacy bare array — its 200/500 defaults are what installed clients rely on. */
  execute(input: ListRunestonesInput): RunestoneSummary[] {
    return this.repo.list(this.filterFor(input, Math.min(Math.max(input.limit ?? 200, 1), 500)));
  }

  /**
   * The paged form (PLAN-31): one page plus the total under the same filters
   * and the unfiltered author facet. Offset-based, because the Pensieve needs
   * random access to page k of a merge it computes itself.
   */
  executePage(input: ListRunestonesInput): DocumentListPage<RunestoneSummary> {
    const filter = this.filterFor(input, pageLimit(input.limit, this.paging));
    return {
      items: this.repo.listPage(filter),
      total: this.repo.count(filter),
      limit: filter.limit,
      offset: filter.offset,
      authors: this.repo.listAuthors(),
    };
  }

  private filterFor(input: ListRunestonesInput, limit: number): RunestoneListFilter {
    const sort = SORTS.includes(input.sort as RunestoneSort)
      ? (input.sort as RunestoneSort)
      : 'modified';
    const order =
      input.order === 'asc' || input.order === 'desc'
        ? input.order
        : sort === 'name'
          ? 'asc'
          : 'desc';
    return {
      q: input.q?.trim() || undefined,
      authorDeviceId: input.author || undefined,
      format: input.format === 'json' || input.format === 'jsonc' ? input.format : undefined,
      sort,
      order,
      limit,
      offset: Math.max(input.offset ?? 0, 0),
    };
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
