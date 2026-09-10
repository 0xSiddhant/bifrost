import type { ApiClient } from './client.js';

/**
 * Wardens, read-only. The write side (`prune`, `name`) is deliberately out of
 * scope: nothing about a CLI session should rename a household device.
 */

export interface PresenceDevice {
  deviceId: string;
  name: string | null;
  charName: string | null;
  label: string;
  online: boolean;
  lastSeen: number;
}

export async function listDevices(client: ApiClient): Promise<PresenceDevice[]> {
  const { devices } = await client.json<{ devices: PresenceDevice[] }>(
    'listing devices',
    'GET',
    '/api/presence',
  );
  return devices;
}
