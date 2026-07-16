import { apiGet } from './api';
import { bifrostEvents } from './sse';

/**
 * Shared deviceId → identity map (PLAN-06). Clipboard entries and audit rows
 * carry a deviceId; this resolves it to a character alias (the display name
 * everywhere) and the original UA label (shown only in Heimdall). Fed by
 * /api/presence and kept live via the `presence.changed` SSE event.
 */
interface PresenceDevice {
  deviceId: string;
  name: string | null;
  charName: string | null;
  label: string;
}

interface DeviceIdentity {
  display: string;
  label: string;
}

let identities = new Map<string, DeviceIdentity>();
const listeners = new Set<() => void>();
let started = false;

function apply(devices: PresenceDevice[]): void {
  identities = new Map(
    devices.map((device) => [
      device.deviceId,
      { display: device.name ?? device.charName ?? device.label, label: device.label },
    ]),
  );
  for (const listener of listeners) listener();
}

export function startDeviceRegistry(): void {
  if (started) return;
  started = true;
  apiGet<{ devices: PresenceDevice[] }>('/api/presence')
    .then((res) => apply(res.devices))
    .catch(() => {});
  bifrostEvents.on('presence.changed', (payload) => {
    if (payload && typeof payload === 'object' && 'devices' in payload) {
      apply((payload as { devices: PresenceDevice[] }).devices);
    }
  });
}

/** Character alias (or claimed name) — the display name used everywhere. */
export function deviceName(deviceId: string | null): string | null {
  return deviceId ? (identities.get(deviceId)?.display ?? null) : null;
}

/** Original UA label ("macOS · Chrome") — shown alongside the alias in Heimdall only. */
export function deviceLabel(deviceId: string | null): string | null {
  return deviceId ? (identities.get(deviceId)?.label ?? null) : null;
}

export function onDevicesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
