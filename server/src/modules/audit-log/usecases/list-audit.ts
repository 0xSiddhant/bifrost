import type { AuditRecord, AuditRepository } from '../ports.js';

export interface AuditListQuery {
  event?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  total: number;
  items: AuditRecord[];
  /** Distinct event names present, for the History filter. */
  events: string[];
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export class ListAuditUseCase {
  constructor(private readonly repo: AuditRepository) {}

  execute(query: AuditListQuery = {}): AuditPage {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Math.trunc(query.offset ?? 0) || 0, 0);
    const page = this.repo.page({
      event: query.event,
      since: query.since,
      until: query.until,
      limit,
      offset,
    });
    return { ...page, events: this.repo.distinctEvents() };
  }
}

export class PruneAuditUseCase {
  constructor(
    private readonly repo: AuditRepository,
    private readonly retentionDays: number,
    private readonly now: () => number = Date.now,
  ) {}

  execute(): number {
    return this.repo.pruneBefore(this.now() - this.retentionDays * 24 * 60 * 60 * 1000);
  }
}
