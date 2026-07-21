import { eq, inArray, sql } from 'drizzle-orm';
import type { DbHandle } from '../../../core/db/index.js';
import { devices } from '../../../core/db/schema.js';
import type { DeviceRepository, KnownDevice } from '../ports.js';

export class DbDeviceRepository implements DeviceRepository {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  upsertSeen(deviceId: string, label: string, charName: string, now: number): void {
    this.db
      .insert(devices)
      .values({ deviceId, label, charName, firstSeen: now, lastSeen: now })
      .onConflictDoUpdate({
        // Keep an existing alias; only fill it if it was never set (e.g. rows
        // that predate the char_name column). Never re-roll an assigned alias.
        target: devices.deviceId,
        set: { label, lastSeen: now, charName: sql`coalesce(${devices.charName}, ${charName})` },
      })
      .run();
  }

  rename(deviceId: string, name: string | null): boolean {
    return this.db.update(devices).set({ name }).where(eq(devices.deviceId, deviceId)).run().changes > 0;
  }

  remove(deviceIds: string[]): number {
    if (deviceIds.length === 0) return 0;
    // No table foreign-keys `devices` — audit/clipboard/runestone keep the raw
    // deviceId string, so this only drops the roster row (activity survives).
    return this.db.delete(devices).where(inArray(devices.deviceId, deviceIds)).run().changes;
  }

  all(): KnownDevice[] {
    return this.db.select().from(devices).all();
  }
}
