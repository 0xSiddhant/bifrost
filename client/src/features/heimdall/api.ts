import { apiGet, apiSend } from '../../core/api';

export interface AccessConfig {
  shortcut: string;
  tapCount: number;
}

export interface HeimdallSettings {
  shortcut: string;
  tapCount: number;
  defaultThemeId: string | null;
}

export interface FolderUsage {
  folder: string;
  bytes: number;
  files: number;
}

export interface Stats {
  uptimeSeconds: number;
  connectedClients: number;
  uploads: { total: number; today: number };
  disk: FolderUsage[];
  totalBytes: number;
  activity: number[];
}

export interface UploadMeta {
  name: string;
  size: number;
  uploadedAt: number;
  uploaderHint: string | null;
}

export interface UploadPage {
  total: number;
  items: UploadMeta[];
}

/** Public — the entry gesture needs the current shortcut + tap count. */
export const fetchAccess = (): Promise<AccessConfig> => apiGet<AccessConfig>('/api/heimdall/access');

export const login = (pin: string): Promise<{ ok: true }> =>
  apiSend<{ ok: true }>('POST', '/api/heimdall/login', { pin });

export const logout = (): Promise<null> => apiSend<null>('POST', '/api/heimdall/logout');

export const fetchSession = (): Promise<{ ok: true }> => apiGet<{ ok: true }>('/api/heimdall/session');

export const revokeSessions = (): Promise<null> => apiSend<null>('POST', '/api/heimdall/revoke');

export const fetchSettings = (): Promise<HeimdallSettings> =>
  apiGet<HeimdallSettings>('/api/heimdall/settings');

export const updateSettings = (
  patch: Partial<{ shortcut: string; tapCount: number; defaultThemeId: string | null }>,
): Promise<HeimdallSettings> =>
  apiSend<HeimdallSettings>('PATCH', '/api/heimdall/settings', patch);

export const fetchStats = (): Promise<Stats> => apiGet<Stats>('/api/heimdall/stats');

export const fetchUploads = (): Promise<UploadPage> => apiGet<UploadPage>('/api/heimdall/uploads');

export interface ManagedTheme {
  id: string;
  name: string;
  mode: 'dark' | 'light';
  builtIn: boolean;
  enabled: boolean;
}

/** Every theme (incl. disabled ones) with its enable state — for the manager. */
export const fetchManagedThemes = (): Promise<{ themes: ManagedTheme[] }> =>
  apiGet<{ themes: ManagedTheme[] }>('/api/themes/manage');

export const setThemeEnabled = (id: string, enabled: boolean): Promise<ManagedTheme> =>
  apiSend<ManagedTheme>('PATCH', `/api/themes/${id}`, { enabled });

export interface AuditRecord {
  id: number;
  ts: number;
  event: string;
  deviceId: string | null;
  ip: string | null;
  summary: string | null;
}

export interface AuditPage {
  total: number;
  items: AuditRecord[];
  events: string[];
}

export interface PresenceDevice {
  deviceId: string;
  name: string | null;
  charName: string | null;
  label: string;
  online: boolean;
  lastSeen: number;
}

export const fetchPresence = (): Promise<{ devices: PresenceDevice[] }> =>
  apiGet<{ devices: PresenceDevice[] }>('/api/presence');

export const fetchAudit = (params: { event?: string; limit?: number } = {}): Promise<AuditPage> => {
  const query = new URLSearchParams();
  if (params.event) query.set('event', params.event);
  query.set('limit', String(params.limit ?? 100));
  return apiGet<AuditPage>(`/api/heimdall/audit?${query.toString()}`);
};
