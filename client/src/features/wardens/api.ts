import { API_V1, apiGet, apiSend } from '../../core/api';

export interface PresenceDevice {
  deviceId: string;
  name: string | null;
  charName: string | null;
  label: string;
  online: boolean;
  lastSeen: number;
}

export const listPresence = (): Promise<{ devices: PresenceDevice[] }> =>
  apiGet<{ devices: PresenceDevice[] }>(`${API_V1}/presence`);

/** Visiting Wardens prunes devices offline > 7 days, then returns the roster. */
export const prunePresence = (): Promise<{ removed: number; devices: PresenceDevice[] }> =>
  apiSend<{ removed: number; devices: PresenceDevice[] }>('POST', `${API_V1}/presence/prune`);

export const renameDevice = (
  deviceId: string,
  name: string | null,
): Promise<{ devices: PresenceDevice[] }> =>
  apiSend<{ devices: PresenceDevice[] }>('PATCH', `${API_V1}/presence/name`, { deviceId, name });
