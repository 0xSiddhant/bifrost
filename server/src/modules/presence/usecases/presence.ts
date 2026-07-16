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
