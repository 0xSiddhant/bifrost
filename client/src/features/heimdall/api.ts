import { API_V1, apiGet, apiSend, hubOnly } from '../../core/api';

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

/**
 * One file currently in uploads/ — read from the directory (PLAN-17b), so it
 * cannot list something that has been deleted on the host. History ("what was
 * sent, by whom, when") is the Activity section's job and comes from
 * `audit_events`.
 */
export interface UploadFileEntry {
  name: string;
  size: number;
  /** Epoch ms — last modified on disk. */
  mtime: number;
}

export interface UploadFilesPage {
  total: number;
  items: UploadFileEntry[];
}

const hubLogin = (pin: string): Promise<{ ok: true }> =>
  apiSend<{ ok: true }>('POST', `${API_V1}/heimdall/login`, { pin });

const hubLogout = (): Promise<null> => apiSend<null>('POST', `${API_V1}/heimdall/logout`);

const hubFetchSession = (): Promise<{ ok: true }> => apiGet<{ ok: true }>(`${API_V1}/heimdall/session`);

const hubRevokeSessions = (): Promise<null> => apiSend<null>('POST', `${API_V1}/heimdall/revoke`);

const hubFetchSettings = (): Promise<HeimdallSettings> =>
  apiGet<HeimdallSettings>(`${API_V1}/heimdall/settings`);

const hubUpdateSettings = (
  patch: Partial<{ shortcut: string; tapCount: number; defaultThemeId: string | null }>,
): Promise<HeimdallSettings> =>
  apiSend<HeimdallSettings>('PATCH', `${API_V1}/heimdall/settings`, patch);

const hubFetchStats = (): Promise<Stats> => apiGet<Stats>(`${API_V1}/heimdall/stats`);

const hubFetchUploads = (): Promise<UploadFilesPage> =>
  apiGet<UploadFilesPage>(`${API_V1}/heimdall/uploads`);

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

const hubFetchPresence = (): Promise<{ devices: PresenceDevice[] }> =>
  apiGet<{ devices: PresenceDevice[] }>(`${API_V1}/presence`);

/** Drop devices offline for > 7 days, then return the fresh roster. */
const hubPrunePresence = (): Promise<{ removed: number; devices: PresenceDevice[] }> =>
  apiSend<{ removed: number; devices: PresenceDevice[] }>('POST', `${API_V1}/presence/prune`);

const hubFetchAudit = (params: { event?: string; limit?: number } = {}): Promise<AuditPage> => {
  const query = new URLSearchParams();
  if (params.event) query.set('event', params.event);
  query.set('limit', String(params.limit ?? 100));
  return apiGet<AuditPage>(`${API_V1}/heimdall/audit?${query.toString()}`);
};

export interface AboutInfo {
  version: string;
  commit: string;
  buildDate: string;
  uptimeSeconds: number;
  node: string;
  host: string;
  profile: 'local' | 'cloud';
}

const hubFetchAbout = (): Promise<AboutInfo> => apiGet<AboutInfo>(`${API_V1}/heimdall/about`);

const hubFetchChangelog = (): Promise<{ content: string }> =>
  apiGet<{ content: string }>(`${API_V1}/heimdall/changelog`);

/*
 * Heimdall's admin API: hub-only. On the standalone site each is a stub with
 * no request, and the sections that call them are absent there (PLAN-35).
 */
export const login: typeof hubLogin = __HUB__ ? hubLogin : hubOnly('login');
export const logout: typeof hubLogout = __HUB__ ? hubLogout : hubOnly('logout');
export const fetchSession: typeof hubFetchSession = __HUB__ ? hubFetchSession : hubOnly('fetchSession');
export const revokeSessions: typeof hubRevokeSessions = __HUB__ ? hubRevokeSessions : hubOnly('revokeSessions');
export const fetchSettings: typeof hubFetchSettings = __HUB__ ? hubFetchSettings : hubOnly('fetchSettings');
export const updateSettings: typeof hubUpdateSettings = __HUB__ ? hubUpdateSettings : hubOnly('updateSettings');
export const fetchStats: typeof hubFetchStats = __HUB__ ? hubFetchStats : hubOnly('fetchStats');
export const fetchUploads: typeof hubFetchUploads = __HUB__ ? hubFetchUploads : hubOnly('fetchUploads');
export const fetchPresence: typeof hubFetchPresence = __HUB__ ? hubFetchPresence : hubOnly('fetchPresence');
export const prunePresence: typeof hubPrunePresence = __HUB__ ? hubPrunePresence : hubOnly('prunePresence');
export const fetchAudit: typeof hubFetchAudit = __HUB__ ? hubFetchAudit : hubOnly('fetchAudit');
export const fetchAbout: typeof hubFetchAbout = __HUB__ ? hubFetchAbout : hubOnly('fetchAbout');
export const fetchChangelog: typeof hubFetchChangelog = __HUB__ ? hubFetchChangelog : hubOnly('fetchChangelog');

// The log viewer, its filters, and the runtime level switch were removed in
// PLAN-16a: Grafana/Loki is the log UI now, and `LOG_LEVEL` in .env (+ restart)
// is the single control. Nothing here reads log lines any more.
