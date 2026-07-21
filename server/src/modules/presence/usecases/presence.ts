import type { EventBus } from '../../../core/bus/index.js';
import type { PresenceDevice } from '../../../core/bus/events.js';
import type { ConnectionInfo } from '../../../core/sse/index.js';
import { AppError } from '../../../core/http/index.js';
import { pickCharacterName } from '../character-names.js';
import { uaLabel } from '../ua.js';
import type { DeviceRepository } from '../ports.js';

/** Merge known devices with the SSE hub's live connections into the dashboard list. */
export class BuildPresenceUseCase {
  constructor(
    private readonly repo: DeviceRepository,
    private readonly connections: () => ConnectionInfo[],
  ) {}

  execute(): PresenceDevice[] {
    const online = new Set<string>();
    for (const connection of this.connections()) {
      if (connection.deviceId) online.add(connection.deviceId);
    }

    const list = this.repo.all().map((device) => ({
      deviceId: device.deviceId,
      name: device.name,
      charName: device.charName,
      label: device.label ?? 'Unknown device',
      online: online.has(device.deviceId),
      lastSeen: device.lastSeen,
    }));

    // Online first, then most-recently-seen.
    list.sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen);
    return list;
  }
}

/** Record every live connection's device (assigning a unique alias to new ones), then broadcast. */
export class SyncPresenceUseCase {
  constructor(
    private readonly repo: DeviceRepository,
    private readonly connections: () => ConnectionInfo[],
    private readonly build: BuildPresenceUseCase,
    private readonly bus: EventBus,
    private readonly now: () => number = Date.now,
    private readonly rng: () => number = Math.random,
  ) {}

  execute(): void {
    const at = this.now();
    const known = new Map(this.repo.all().map((device) => [device.deviceId, device]));
    const used = new Set(
      [...known.values()]
        .map((device) => device.charName)
        .filter((name): name is string => Boolean(name)),
    );

    for (const connection of this.connections()) {
      if (!connection.deviceId) continue;
      const existing = known.get(connection.deviceId);
      const charName = existing?.charName ?? pickCharacterName(used, this.rng);
      if (!existing?.charName) used.add(charName);
      this.repo.upsertSeen(connection.deviceId, uaLabel(connection.ua), charName, at);
    }

    this.bus.emit('presence.changed', { devices: this.build.execute() });
  }
}

/** Devices unseen for longer than this are pruned on demand (PLAN-10). */
export const STALE_DEVICE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * On-demand cleanup (triggered when a Wardens surface is opened): drop devices
 * that have been offline and unseen for more than 7 days. Currently-connected
 * devices are never pruned regardless of a stale lastSeen. Only the roster row
 * is deleted — the device's audit/clipboard/runestone activity is untouched
 * (those keep the raw deviceId and resolve to a "departed device" label).
 */
export class PruneStaleDevicesUseCase {
  constructor(
    private readonly repo: DeviceRepository,
    private readonly connections: () => ConnectionInfo[],
    private readonly build: BuildPresenceUseCase,
    private readonly bus: EventBus,
    private readonly now: () => number = Date.now,
  ) {}

  execute(): { removed: number; devices: PresenceDevice[] } {
    const cutoff = this.now() - STALE_DEVICE_MS;
    const online = new Set<string>();
    for (const connection of this.connections()) {
      if (connection.deviceId) online.add(connection.deviceId);
    }
    const stale = this.repo
      .all()
      .filter((device) => device.lastSeen < cutoff && !online.has(device.deviceId))
      .map((device) => device.deviceId);

    const removed = this.repo.remove(stale);
    const devices = this.build.execute();
    if (removed > 0) this.bus.emit('presence.changed', { devices });
    return { removed, devices };
  }
}

export class ClaimNameUseCase {
  constructor(
    private readonly repo: DeviceRepository,
    private readonly build: BuildPresenceUseCase,
    private readonly bus: EventBus,
  ) {}

  execute(deviceId: string, name: string | null): PresenceDevice[] {
    const clean = typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : null;
    if (!this.repo.rename(deviceId, clean)) {
      throw new AppError('device not found', 404, 'NOT_FOUND');
    }
    const devices = this.build.execute();
    this.bus.emit('presence.changed', { devices });
    return devices;
  }
}
