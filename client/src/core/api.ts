import { showBridgeClosed } from './bridge';
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
 * The request never reached the hub (PLAN-35): a refused or dropped connection
 * (fetch's `TypeError`) or a `timeoutMs` that ran out. Distinct from
 * `ApiError`, which means the server *answered*, if only with a 4xx or 5xx.
 * Raising it also shows "The Bifröst is closed" with "Try again".
 */
export class HubUnreachableError extends Error {
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    super('The Bifröst is closed: the hub could not be reached.', { cause });
    this.name = 'HubUnreachableError';
  }
}

/**
 * The standalone build has no hub to ask (PLAN-35). Every hub request there is
 * compiled to a stub that throws this without touching the network.
 */
export class HubUnavailableError extends Error {
  constructor(public readonly action: string) {
    super('This needs your Bifrost hub, and the standalone site has none.');
    this.name = 'HubUnavailableError';
  }
}

/** Either way the hub is out of reach: what a page checks before its own error message. */
export function isHubClosed(error: unknown): boolean {
  return error instanceof HubUnreachableError || error instanceof HubUnavailableError;
}

/**
 * The calls each standalone stub has taken, in order. A cold-loaded page must
 * leave this empty (the network guard cannot see stubs: they never touch the
 * network), so the standalone e2e project reads it from `window`.
 */
const stubCalls: string[] = [];
if (!__HUB__) (globalThis as { __bifrostStubCalls?: string[] }).__bifrostStubCalls = stubCalls;

export function standaloneStubCalls(): readonly string[] {
  return stubCalls;
}

/**
 * The standalone stand-in for a hub request, used as `__HUB__ ? real : hubOnly('name')`.
 * Because `__HUB__` is a literal in a build, the bundler drops the real branch
 * and its path from the standalone bundle; `scripts/check-standalone.ts`
 * proves it.
 */
export function hubOnly(action: string): (...args: unknown[]) => Promise<never> {
  return () => {
    stubCalls.push(action);
    showBridgeClosed({ reason: 'standalone' });
    return Promise.reject(new HubUnavailableError(action));
  };
}

/**
 * fetch, with a failure that never reached the server turned into
 * `HubUnreachableError`. A caller's own abort (a list whose filter changed)
 * stays an `AbortError`: that is the page cancelling, not the hub being down.
 */
async function hubFetch(path: string, init: RequestInit, timed: boolean): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const lost =
      error instanceof TypeError || (timed && (name === 'TimeoutError' || name === 'AbortError'));
    if (!lost) throw error;
    showBridgeClosed({ reason: 'unreachable' });
    throw new HubUnreachableError(path, error);
  }
}

/**
 * Reads the server's `{ error, message }` error body (best-effort) so callers
 * can show the specific reason — a Portkey 422 says *why* the slug/target was
 * refused, not just "failed". Falls back to a generic message on a non-JSON body.
 */
/**
 * PLAN-36: behind the web host, an API that is down arrives as an HTTP 502
 * with `{ error: 'HUB_UNAVAILABLE' }`, not as a network failure. It means the
 * same thing (the bridge is closed), so it gets the same sheet and error.
 */
function closedOr(path: string, error: ApiError): Error {
  if (error.code !== 'HUB_UNAVAILABLE') return error;
  showBridgeClosed({ reason: 'unreachable' });
  return new HubUnreachableError(path, error);
}

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
  /** Abort from the caller — a list whose filter changed drops its old request. */
  signal?: AbortSignal;
}

async function hubGet<T>(path: string, options: ApiGetOptions = {}): Promise<T> {
  const timed = options.timeoutMs !== undefined;
  const response = await hubFetch(
    path,
    {
      headers: { accept: 'application/json' },
      // One or the other: `AbortSignal.any` would combine them, but it is Safari
      // 17.4+ and the LAN's iPads are not all that new. No caller needs both.
      signal:
        options.timeoutMs === undefined ? options.signal : AbortSignal.timeout(options.timeoutMs),
    },
    timed,
  );
  if (!response.ok) {
    throw closedOr(path, await toApiError('GET', path, response));
  }
  return (await response.json()) as T;
}

/**
 * POST/PATCH/DELETE with an optional JSON body. Same-origin cookies ride along
 * by default (fetch credentials: 'same-origin'), which is how the Heimdall
 * session cookie authenticates writes. Returns null for empty (204) responses.
 */
async function hubSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    // Attributes writes to this device (clipboard, PLAN-06). Not auth.
    'x-bifrost-device': getDeviceId(),
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await hubFetch(
    path,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    false,
  );
  if (!response.ok) {
    throw closedOr(path, await toApiError(method, path, response));
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** GET a JSON body from the hub. On the standalone site, a stub: no network, ever. */
export const apiGet: <T>(path: string, options?: ApiGetOptions) => Promise<T> = __HUB__
  ? hubGet
  : hubOnly('apiGet');

/** Send to the hub. On the standalone site, a stub: no network, ever. */
export const apiSend: <T>(method: string, path: string, body?: unknown) => Promise<T> = __HUB__
  ? hubSend
  : hubOnly('apiSend');

/**
 * The paged list envelopes (PLAN-31) — shared by name with the server's
 * `core/paging.ts`, since the two workspaces cannot share an import. Only a
 * request carrying `paged=true` gets one; without it every list endpoint
 * still answers with a bare array.
 */
export interface DocumentListPage<T> {
  items: T[];
  /** Rows matching the filters, across every page. */
  total: number;
  /** The page size the server used — the client never hardcodes one. */
  limit: number;
  offset: number;
  /** Every author of this kind, unfiltered. */
  authors: string[];
}

export interface CursorListPage<T> {
  items: T[];
  total: number;
  limit: number;
  /** Opaque; null when nothing follows the last row. */
  nextCursor: string | null;
}

/** Where to start a document page, and (optionally) how many rows. */
export interface OffsetRequest {
  offset: number;
  /** Omitted = the server's LIST_PAGE_SIZE. */
  limit?: number;
}

/** `?paged=true&offset=…[&limit=…]` appended to a document list's own filters. */
export function pagedParams(params: URLSearchParams, request: OffsetRequest): string {
  params.set('paged', 'true');
  params.set('offset', String(request.offset));
  if (request.limit !== undefined) params.set('limit', String(request.limit));
  return params.toString();
}

/**
 * Downloads are a shared resource: file-transfer lists them, previews views
 * them — features can't import each other, so the contract lives here.
 */
export interface DownloadEntry {
  id: string;
  /** Base name — `parent` carries the folder, so this is never path-qualified. */
  name: string;
  /** Folders report 0; a folder's size is summed from its children in this feed. */
  size: number;
  mtime: number;
  ext: string;
  /** PLAN-24: the listing is one level deep, so an entry is a file or a folder. */
  type: 'file' | 'folder';
  /** Folder this entry lives in, or null at the root. Folders are always root. */
  parent: string | null;
}

export const listDownloads = (): Promise<DownloadEntry[]> =>
  apiGet<DownloadEntry[]>('/api/downloads');

export const downloadUrl = (id: string, options: { inline?: boolean } = {}): string =>
  `/api/downloads/${id}/content${options.inline ? '?inline=1' : ''}`;
