import type { NimbusResult } from '../../core/bus/events.js';

export type { NimbusResult };

/** A result on its way into the DB — the id is the table's. */
export type NewNimbusResult = Omit<NimbusResult, 'id'>;

export interface NimbusListFilter {
  /** Exact device id; absent = every device. */
  deviceId?: string;
  limit: number;
}

/** DB access for the speed-test history — usecases never touch Drizzle. */
export interface NimbusRepository {
  insert(result: NewNimbusResult): NimbusResult;
  /** Newest first. */
  list(filter: NimbusListFilter): NimbusResult[];
  /** Retention prune; returns the number of rows removed. */
  deleteBefore(ts: number): number;
}
