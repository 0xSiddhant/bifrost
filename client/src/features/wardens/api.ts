import { apiGet, apiSend } from '../../core/api';

export interface PresenceDevice {
  deviceId: string;
  name: string | null;
  charName: string | null;
  label: string;
  online: boolean;
  lastSeen: number;
}

export const listPresence = (): Promise<{ devices: PresenceDevice[] }> =>
  apiGet<{ devices: PresenceDevice[] }>('/api/presence');

/** Visiting Wardens prunes devices offline > 7 days, then returns the roster. */
export const prunePresence = (): Promise<{ removed: number; devices: PresenceDevice[] }> =>
  apiSend<{ removed: number; devices: PresenceDevice[] }>('POST', '/api/presence/prune');

export const renameDevice = (
  deviceId: string,
  name: string | null,
): Promise<{ devices: PresenceDevice[] }> =>
  apiSend<{ devices: PresenceDevice[] }>('PATCH', '/api/presence/name', { deviceId, name });
