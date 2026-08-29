import { getDeviceId } from './deviceId';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Server error code (`{error}` in the body), when one was sent. */
    public readonly code?: string,
    /** Human reason from the server (`{message}`), when one was sent. */
    public readonly detail?: string,
    /**
     * Machine-readable extras for a refusal the UI can act on — the rename
     * 422 carries `{ suggestion }`, the cleaned-up name the server would have
     * used, so the modal can offer it as a button instead of prose.
     */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Reads the server's `{ error, message }` error body (best-effort) so callers
 * can show the specific reason — a Portkey 422 says *why* the slug/target was
 * refused, not just "failed". Falls back to a generic message on a non-JSON body.
 */
async function toApiError(method: string, path: string, response: Response): Promise<ApiError> {
  const fallback = `${method} ${path} failed with ${response.status}`;
  try {
    const body = (await response.json()) as {
      error?: unknown;
      message?: unknown;
      details?: unknown;
    };
    const code = typeof body.error === 'string' ? body.error : undefined;
    const detail = typeof body.message === 'string' ? body.message : undefined;
    const details =
      body.details && typeof body.details === 'object'
        ? (body.details as Record<string, unknown>)
        : undefined;
    return new ApiError(response.status, detail ?? fallback, code, detail, details);
  } catch {
    return new ApiError(response.status, fallback);
  }
}

export interface ApiGetOptions {
  /**
   * Abort after this many ms. Off by default: most reads are behind a UI that
   * can wait, and a few (Nimbus) are long by design. Pass it where a hung
   * request leaves a control permanently dead — a vanished host never refuses
   * the connection, it just never answers.
   */
  timeoutMs?: number;
}

export async function apiGet<T>(path: string, options: ApiGetOptions = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
    signal: options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    throw await toApiError('GET', path, response);
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
    throw await toApiError(method, path, response);
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
