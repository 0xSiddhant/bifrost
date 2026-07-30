import type { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import { newAccioId } from '../id.js';
import type { AccioLink, AccioListFilter, AccioRepository, AccioSort, TitleFetcher } from '../ports.js';
import { normalizeTags } from '../tags.js';
import { TITLE_MAX_LENGTH } from '../title.js';
import { isWebUrl, normalizeUrl } from '../url.js';

export interface AccioDeps {
  repo: AccioRepository;
  bus: EventBus;
  now?: () => number;
  rng?: () => number;
}

/** A client-supplied title is trusted but bounded — same cap as a fetched one. */
function cleanTitle(title: string | undefined): string | null {
  const text = title?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > TITLE_MAX_LENGTH ? text.slice(0, TITLE_MAX_LENGTH) : text;
}

export interface SaveLinkInput {
  url: string;
  title?: string;
  tags?: string[];
  authorDeviceId: string | null;
}

/**
 * Saving is deliberately synchronous and complete: the row exists (and is
 * broadcast) the moment the URL parses. Title lookup happens afterwards, out of
 * band — see EnrichTitleUseCase — so a slow or unreachable site never delays,
 * and never fails, a save.
 */
export class SaveLinkUseCase {
  constructor(private readonly deps: AccioDeps) {}

  execute(input: SaveLinkInput): AccioLink {
    const { repo, bus } = this.deps;
    const now = this.deps.now ?? Date.now;
    const rng = this.deps.rng ?? Math.random;

    const url = normalizeUrl(input.url);
    if (!url) {
      throw new AppError('not a valid http(s) URL', 422, 'UNPROCESSABLE_ENTITY');
    }

    let id = newAccioId(rng);
    while (repo.hasId(id)) id = newAccioId(rng);

    const link: AccioLink = {
      id,
      url,
      title: cleanTitle(input.title),
      tags: normalizeTags(input.tags ?? []),
      authorDeviceId: input.authorDeviceId,
      createdAt: now(),
    };
    repo.insert(link);
    bus.emit('accio.saved', { link });
    return link;
  }
}

export interface UpdateLinkInput {
  id: string;
  title?: string;
  tags?: string[];
}

export class UpdateLinkUseCase {
  constructor(private readonly deps: AccioDeps) {}

  execute(input: UpdateLinkInput): AccioLink {
    const { repo, bus } = this.deps;

    const existing = repo.findById(input.id);
    if (!existing) throw new AppError('link not found', 404, 'NOT_FOUND');

    const link: AccioLink = {
      ...existing,
      // An explicit empty title clears it back to "show the bare URL".
      title: input.title !== undefined ? cleanTitle(input.title) : existing.title,
      tags: input.tags !== undefined ? normalizeTags(input.tags) : existing.tags,
    };
    repo.update(link);
    bus.emit('accio.updated', { link });
    return link;
  }
}

export interface ListLinksInput {
  q?: string;
  tag?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

const SORTS: readonly AccioSort[] = ['created', 'title', 'url'];

export class ListLinksUseCase {
  constructor(private readonly repo: AccioRepository) {}

  execute(input: ListLinksInput): AccioLink[] {
    const sort = SORTS.includes(input.sort as AccioSort) ? (input.sort as AccioSort) : 'created';
    const order =
      input.order === 'asc' || input.order === 'desc'
        ? input.order
        : sort === 'created'
          ? 'desc'
          : 'asc';
    // The tag filter must match what save/update stored, so it goes through the
    // same normalizer — "Recipes" in the query finds rows tagged "recipes".
    const [tag] = normalizeTags(input.tag ? [input.tag] : []);
    const filter: AccioListFilter = {
      q: input.q?.trim() || undefined,
      tag,
      sort,
      order,
      limit: Math.min(Math.max(input.limit ?? 200, 1), 500),
      offset: Math.max(input.offset ?? 0, 0),
    };
    return this.repo.list(filter);
  }
}

export class DeleteLinkUseCase {
  constructor(
    private readonly repo: AccioRepository,
    private readonly bus: EventBus,
  ) {}

  execute(id: string): void {
    const deleted = this.repo.delete(id);
    if (!deleted) throw new AppError('link not found', 404, 'NOT_FOUND');
    this.bus.emit('accio.deleted', { id: deleted.id, url: deleted.url, title: deleted.title });
  }
}

/**
 * Post-save title lookup. Runs detached from the request (the module triggers
 * it off `accio.saved`), so every outcome here is non-fatal:
 *
 * - site unreachable / no title / not HTML → the row keeps its bare URL,
 * - row deleted or retitled while the fetch was in flight → we leave it alone,
 * - success → the row is patched and `accio.updated` patches every open shelf.
 */
export class EnrichTitleUseCase {
  constructor(
    private readonly repo: AccioRepository,
    private readonly bus: EventBus,
    private readonly fetcher: TitleFetcher,
  ) {}

  async execute(id: string): Promise<void> {
    const before = this.repo.findById(id);
    if (!before || before.title) return;
    // Only http(s) has a page to read a title from; chrome://, mailto: and the
    // like have nothing to fetch (and fetch() would throw on them).
    if (!isWebUrl(before.url)) return;

    const title = cleanTitle((await this.fetcher.fetchTitle(before.url)) ?? undefined);
    if (!title) return;

    // Re-read: the user may have deleted the row or typed their own title while
    // the request was in flight. Their choice wins over ours.
    const current = this.repo.findById(id);
    if (!current || current.title) return;

    const link: AccioLink = { ...current, title };
    this.repo.update(link);
    this.bus.emit('accio.updated', { link });
  }
}
