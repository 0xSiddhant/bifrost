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
