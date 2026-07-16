/** One row of the activity log. */
export interface AuditRecord {
  id: number;
  ts: number;
  event: string;
  deviceId: string | null;
  ip: string | null;
  summary: string | null;
}

export interface NewAuditRecord {
  ts: number;
  event: string;
  deviceId: string | null;
  ip: string | null;
  summary: string | null;
}

export interface AuditQuery {
  event?: string;
  since?: number;
  until?: number;
  limit: number;
  offset: number;
}

export interface AuditRepository {
  append(record: NewAuditRecord): void;
  page(query: AuditQuery): { total: number; items: AuditRecord[] };
  /** Distinct event names present, for the filter dropdown. */
  distinctEvents(): string[];
  /** Delete rows older than `ts`; returns how many. */
  pruneBefore(ts: number): number;
}
