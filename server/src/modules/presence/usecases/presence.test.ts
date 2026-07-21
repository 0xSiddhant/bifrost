import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import type { PresenceDevice } from '../../../core/bus/events.js';
import type { ConnectionInfo } from '../../../core/sse/index.js';
import type { DeviceRepository, KnownDevice } from '../ports.js';
import {
  BuildPresenceUseCase,
  ClaimNameUseCase,
  PruneStaleDevicesUseCase,
  STALE_DEVICE_MS,
  SyncPresenceUseCase,
} from './presence.js';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

class FakeDeviceRepo implements DeviceRepository {
  store = new Map<string, KnownDevice>();
  upsertSeen(deviceId: string, label: string, charName: string, now: number): void {
    const existing = this.store.get(deviceId);
    if (existing) {
      existing.label = label;
      existing.lastSeen = now;
      // coalesce: fill a missing alias, never overwrite an assigned one.
      if (existing.charName === null) existing.charName = charName;
    } else {
      this.store.set(deviceId, {
        deviceId,
        name: null,
        charName,
        label,
        firstSeen: now,
        lastSeen: now,
      });
    }
  }
  rename(deviceId: string, name: string | null): boolean {
    const device = this.store.get(deviceId);
    if (!device) return false;
    device.name = name;
    return true;
  }
  remove(deviceIds: string[]): number {
    let removed = 0;
    for (const id of deviceIds) if (this.store.delete(id)) removed += 1;
    return removed;
  }
  all(): KnownDevice[] {
    return [...this.store.values()];
  }
}

function build() {
  const repo = new FakeDeviceRepo();
  let connections: ConnectionInfo[] = [];
  const buildPresence = new BuildPresenceUseCase(repo, () => connections);
  const bus = new EventBus();
  const events: { devices: PresenceDevice[] }[] = [];
  bus.on('presence.changed', (e) => events.push(e));
  const sync = new SyncPresenceUseCase(repo, () => connections, buildPresence, bus, () => 1000);
  return {
    repo,
    buildPresence,
    bus,
    events,
    sync,
    setConnections: (c: ConnectionInfo[]) => {
      connections = c;
    },
  };
}

describe('presence', () => {
  it('records a connected device with a UA label, character alias, and online', () => {
    const { setConnections, sync, buildPresence, events } = build();
    setConnections([{ deviceId: 'iphone-1', ua: IPHONE_UA, ip: '1.2.3.4', since: 1000 }]);
    sync.execute();

    const list = buildPresence.execute();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ deviceId: 'iphone-1', online: true, name: null });
    expect(list[0]?.label).toBe('iPhone · Safari');
    expect(list[0]?.charName).toBeTruthy(); // assigned from the pool
    expect(events).toHaveLength(1);
  });

  it('assigns distinct aliases and preserves them across syncs', () => {
    const { setConnections, sync, buildPresence } = build();
    setConnections([
      { deviceId: 'a', ua: IPHONE_UA, ip: '1.1.1.1', since: 1 },
      { deviceId: 'b', ua: IPHONE_UA, ip: '2.2.2.2', since: 1 },
    ]);
    sync.execute();
    const first = buildPresence.execute();
    const aliasA = first.find((d) => d.deviceId === 'a')?.charName;
    const aliasB = first.find((d) => d.deviceId === 'b')?.charName;
    expect(aliasA).toBeTruthy();
    expect(aliasB).toBeTruthy();
    expect(aliasA).not.toBe(aliasB); // unique

    sync.execute(); // a second sighting must not re-roll the alias
    const second = buildPresence.execute();
    expect(second.find((d) => d.deviceId === 'a')?.charName).toBe(aliasA);
  });

  it('marks a known device offline once its connection is gone', () => {
    const { setConnections, sync, buildPresence } = build();
    setConnections([{ deviceId: 'iphone-1', ua: IPHONE_UA, ip: '1.2.3.4', since: 1000 }]);
    sync.execute();
    setConnections([]);
    const list = buildPresence.execute();
    expect(list[0]).toMatchObject({ deviceId: 'iphone-1', online: false });
  });

  it('ignores connections without a deviceId', () => {
    const { setConnections, sync, buildPresence } = build();
    setConnections([{ deviceId: null, ua: IPHONE_UA, ip: '1.2.3.4', since: 1000 }]);
    sync.execute();
    expect(buildPresence.execute()).toHaveLength(0);
  });

  it('claims a friendly name and broadcasts, 404s an unknown device', () => {
    const { setConnections, sync, buildPresence, bus, repo } = build();
    setConnections([{ deviceId: 'iphone-1', ua: IPHONE_UA, ip: '1.2.3.4', since: 1000 }]);
    sync.execute();

    const claim = new ClaimNameUseCase(repo, buildPresence, bus);
    const after = claim.execute('iphone-1', "  Sid's iPhone  ");
    expect(after[0]?.name).toBe("Sid's iPhone");
    expect(() => claim.execute('ghost', 'x')).toThrow(AppError);
  });

  it('prunes only devices offline for more than 7 days, keeping the online ones', () => {
    const now = 100 * STALE_DEVICE_MS;
    const { repo, buildPresence, bus, events } = build();
    let connections: ConnectionInfo[] = [];
    // stale + offline → pruned; recently seen → kept; stale but still online → kept.
    repo.upsertSeen('stale', 'iPhone · Safari', 'Thor', now - STALE_DEVICE_MS - 1);
    repo.upsertSeen('recent', 'iPhone · Safari', 'Loki', now - 1000);
    repo.upsertSeen('stale-online', 'iPhone · Safari', 'Odin', now - STALE_DEVICE_MS - 1);
    connections = [{ deviceId: 'stale-online', ua: IPHONE_UA, ip: '9.9.9.9', since: now }];

    const prune = new PruneStaleDevicesUseCase(repo, () => connections, buildPresence, bus, () => now);
    const result = prune.execute();

    expect(result.removed).toBe(1);
    const ids = repo.all().map((d) => d.deviceId).sort();
    expect(ids).toEqual(['recent', 'stale-online']);
    expect(events).toHaveLength(1); // broadcast fired because something changed
  });

  it('broadcasts nothing when there is nothing stale to prune', () => {
    const now = 100 * STALE_DEVICE_MS;
    const { repo, buildPresence, bus, events } = build();
    repo.upsertSeen('recent', 'iPhone · Safari', 'Loki', now - 1000);
    const prune = new PruneStaleDevicesUseCase(repo, () => [], buildPresence, bus, () => now);
    expect(prune.execute().removed).toBe(0);
    expect(events).toHaveLength(0);
  });
});
