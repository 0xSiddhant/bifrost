import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { nimbusResults } from '../../../core/db/schema.js';
import type {
  NewNimbusResult,
  NimbusListFilter,
  NimbusRepository,
  NimbusResult,
} from '../ports.js';

export class DbNimbusRepository implements NimbusRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  insert(result: NewNimbusResult): NimbusResult {
    const row = this.db.insert(nimbusResults).values(result).returning().get();
    return row;
  }

  list(filter: NimbusListFilter): NimbusResult[] {
    const conditions: SQL[] = [];
    if (filter.deviceId) conditions.push(eq(nimbusResults.deviceId, filter.deviceId));

    let query = this.db.select().from(nimbusResults).$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    return query
      // Newest first, id as the tiebreak so two tests in the same millisecond
      // still have a stable order.
      .orderBy(desc(nimbusResults.createdAt), desc(nimbusResults.id))
      .limit(filter.limit)
      .all();
  }

  deleteBefore(ts: number): number {
    return this.db.delete(nimbusResults).where(lt(nimbusResults.createdAt, ts)).run().changes;
  }
}
