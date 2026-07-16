import { getDeviceId } from './deviceId';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * POST/PATCH/DELETE with an optional JSON body. Same-origin cookies ride along
 * by default (fetch credentials: 'same-origin'), which is how the Heimdall
 * session cookie authenticates writes. Returns null for empty (204) responses.
 */
export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    // Attributes writes to this device (clipboard, PLAN-06). Not auth.
    'x-bifrost-device': getDeviceId(),
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiError(response.status, `${method} ${path} failed with ${response.status}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface Capabilities {
  profile: 'local' | 'cloud';
  modules: string[];
}

export function fetchCapabilities(): Promise<Capabilities> {
  return apiGet<Capabilities>('/api/capabilities');
}

/**
 * Downloads are a shared resource: file-transfer lists them, previews views
 * them — features can't import each other, so the contract lives here.
 */
export interface DownloadEntry {
  id: string;
  name: string;
  size: number;
  mtime: number;
  ext: string;
}

export const listDownloads = (): Promise<DownloadEntry[]> =>
  apiGet<DownloadEntry[]>('/api/downloads');

export const downloadUrl = (id: string, options: { inline?: boolean } = {}): string =>
  `/api/downloads/${id}/content${options.inline ? '?inline=1' : ''}`;
