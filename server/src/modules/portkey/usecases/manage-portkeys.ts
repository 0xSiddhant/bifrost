import type { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import type { Portkey, PortkeyListFilter, PortkeyRepository } from '../ports.js';
import { validateSlug } from '../slug.js';
import { normalizeTarget } from '../target.js';

/** Notes are free text but bounded — a go-link is a hop, not a document. */
export const NOTE_MAX_LENGTH = 200;

function cleanNote(note: string | undefined): string | null {
  const text = note?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > NOTE_MAX_LENGTH ? text.slice(0, NOTE_MAX_LENGTH) : text;
}

/** Turns a raw target into a stored URL or a 422 with the reason. */
function requireTarget(raw: string): string {
  const url = normalizeTarget(raw);
  if (!url) {
    throw new AppError('target must be an http(s) address', 422, 'UNPROCESSABLE_ENTITY');
  }
  return url;
}

export interface CreatePortkeyInput {
  slug: string;
  url: string;
  note?: string;
  authorDeviceId: string | null;
}

export class CreatePortkeyUseCase {
  constructor(
    private readonly repo: PortkeyRepository,
    private readonly bus: EventBus,
    private readonly now: () => number = Date.now,
  ) {}

  execute(input: CreatePortkeyInput): Portkey {
    const slugResult = validateSlug(input.slug);
    if (!slugResult.ok) {
      throw new AppError(slugResult.reason, 422, 'UNPROCESSABLE_ENTITY');
    }
    const slug = slugResult.slug;
    const url = requireTarget(input.url);

    // The slug is the identity, so a taken one is a 409 the UI turns into
    // "already enchanted → view it" rather than a silent overwrite.
    if (this.repo.hasSlug(slug)) {
      throw new AppError(`/go/${slug} is already enchanted`, 409, 'CONFLICT');
    }

    const portkey: Portkey = {
      slug,
      url,
      note: cleanNote(input.note),
      hits: 0,
      authorDeviceId: input.authorDeviceId,
      createdAt: this.now(),
      lastUsedAt: null,
    };
    this.repo.insert(portkey);
    this.bus.emit('portkey.saved', { portkey });
    return portkey;
  }
}

export interface UpdatePortkeyInput {
  slug: string;
  url?: string;
  note?: string;
}

export class UpdatePortkeyUseCase {
  constructor(
    private readonly repo: PortkeyRepository,
    private readonly bus: EventBus,
  ) {}

  execute(input: UpdatePortkeyInput): Portkey {
    const existing = this.repo.findBySlug(input.slug);
    if (!existing) throw new AppError('portkey not found', 404, 'NOT_FOUND');

    // Slug is immutable — it's the identity and every printed QR points at it;
    // a rename is delete + recreate, on purpose.
    const url = input.url !== undefined ? requireTarget(input.url) : existing.url;
    const note = input.note !== undefined ? cleanNote(input.note) : existing.note;

    const portkey = this.repo.update(input.slug, { url, note });
    if (!portkey) throw new AppError('portkey not found', 404, 'NOT_FOUND');
    this.bus.emit('portkey.saved', { portkey });
    return portkey;
  }
}

export interface ListPortkeysInput {
  q?: string;
  limit?: number;
  offset?: number;
}

export class ListPortkeysUseCase {
  constructor(private readonly repo: PortkeyRepository) {}

  execute(input: ListPortkeysInput): Portkey[] {
    const filter: PortkeyListFilter = {
      q: input.q?.trim() || undefined,
      limit: Math.min(Math.max(input.limit ?? 500, 1), 1000),
      offset: Math.max(input.offset ?? 0, 0),
    };
    return this.repo.list(filter);
  }
}

export class DeletePortkeyUseCase {
  constructor(
    private readonly repo: PortkeyRepository,
    private readonly bus: EventBus,
  ) {}

  execute(slug: string): void {
    const deleted = this.repo.delete(slug);
    if (!deleted) throw new AppError('portkey not found', 404, 'NOT_FOUND');
    this.bus.emit('portkey.deleted', { slug: deleted.slug, url: deleted.url });
  }
}

/**
 * Read-only slug → target lookup for the `/go/:slug` redirect. Deliberately
 * pure of side effects: the hit count is bumped separately, AFTER the response
 * is sent (RecordHitUseCase), so resolving a link never writes on the hot path.
 */
export class ResolvePortkeyUseCase {
  constructor(private readonly repo: PortkeyRepository) {}

  execute(slug: string): Portkey | null {
    return this.repo.findBySlug(slug);
  }
}

/**
 * The async half of a redirect: bump hits + stamp last-used, off the hot path,
 * then emit `portkey.hit` so open management pages update live. Emitting here
 * (not `portkey.saved`) keeps hits out of the audit log.
 */
export class RecordHitUseCase {
  constructor(
    private readonly repo: PortkeyRepository,
    private readonly bus: EventBus,
    private readonly now: () => number = Date.now,
  ) {}

  execute(slug: string): void {
    const portkey = this.repo.recordHit(slug, this.now());
    if (portkey) this.bus.emit('portkey.hit', { portkey });
  }
}
