import { randomUUID } from 'node:crypto';
import type { EventBus } from '../../../core/bus/index.js';
import type { ClipboardEntry } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import type { ClipboardRepository } from '../ports.js';

export interface AddClipboardInput {
  text: string;
  kind?: string;
  lang?: string;
  ttlSeconds?: number;
  deviceId: string | null;
}

export interface ClipboardDeps {
  repo: ClipboardRepository;
  bus: EventBus;
  maxEntries: number;
  maxTextBytes: number;
  now?: () => number;
  genId?: () => string;
}

export class AddClipboardEntryUseCase {
  constructor(private readonly deps: ClipboardDeps) {}

  execute(input: AddClipboardInput): ClipboardEntry {
    const { repo, bus, maxEntries, maxTextBytes } = this.deps;
    const now = this.deps.now ?? Date.now;
    const genId = this.deps.genId ?? randomUUID;

    const text = input.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new AppError('clipboard text is required', 400, 'EMPTY');
    }
    if (Buffer.byteLength(text, 'utf8') > maxTextBytes) {
      throw new AppError('clipboard entry too large', 413, 'PAYLOAD_TOO_LARGE');
    }

    const kind = input.kind === 'code' ? 'code' : 'text';
    const lang =
      kind === 'code' && typeof input.lang === 'string' && input.lang.trim()
        ? input.lang.trim().slice(0, 32)
        : null;
    const at = now();
    const entry: ClipboardEntry = {
      id: genId(),
      text,
      kind,
      lang,
      deviceId: input.deviceId,
      createdAt: at,
    };
    const expiresAt =
      typeof input.ttlSeconds === 'number' && input.ttlSeconds > 0
        ? at + Math.floor(input.ttlSeconds) * 1000
        : null;

    repo.insert({ ...entry, expiresAt });
    bus.emit('clipboard.updated', { action: 'add', entry });

    // Oldest-out once the board is over the cap.
    for (const id of repo.prune(maxEntries, at)) {
      if (id !== entry.id) bus.emit('clipboard.updated', { action: 'delete', id });
    }

    return entry;
  }
}

export class ListClipboardUseCase {
  constructor(
    private readonly repo: ClipboardRepository,
    private readonly now: () => number = Date.now,
  ) {}

  execute(): ClipboardEntry[] {
    return this.repo.list(this.now());
  }
}

export class DeleteClipboardEntryUseCase {
  constructor(
    private readonly repo: ClipboardRepository,
    private readonly bus: EventBus,
  ) {}

  execute(id: string): void {
    if (!this.repo.delete(id)) throw new AppError('entry not found', 404, 'NOT_FOUND');
    this.bus.emit('clipboard.updated', { action: 'delete', id });
  }
}

/** Timer/boot sweep of expired entries; broadcasts each removal. */
export class PruneClipboardUseCase {
  constructor(
    private readonly repo: ClipboardRepository,
    private readonly bus: EventBus,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  execute(): void {
    for (const id of this.repo.prune(this.maxEntries, this.now())) {
      this.bus.emit('clipboard.updated', { action: 'delete', id });
    }
  }
}
