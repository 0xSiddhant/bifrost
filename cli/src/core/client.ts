import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { deviceId, readConfig } from './config.js';
import { isConnectFailure, LOCAL_FALLBACKS, resolveBaseUrl, unreachable } from './discover.js';
import { CliError, EXIT, note } from './output.js';

/**
 * The one place that talks HTTP, and the one place that turns a failure into a
 * sentence. Every `core/` wrapper above it (files, clipboard, portkey, …) is a
 * thin call through here, which is why the error table below is unit-tested
 * directly instead of being trusted to whichever statuses the integration suite
 * happens to provoke.
 *
 * `postFiles` is the one method that does NOT use `fetch`, and the reason is
 * measured rather than assumed — see PLAN-27's mandated push spike: `fetch` +
 * `FormData` (even with `fs.openAsBlob`) buffers the whole file, putting ~412 MB
 * into the live set for a 400 MB upload, and a `duplex: 'half'` stream body does
 * the same. `node:http` with the multipart envelope piped in holds ~23 MB for
 * that file. Neither branch costs a dependency.
 */

/** JSON calls are short; a hung LAN link should not wedge the command forever. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** A fallback probe only asks whether a hub is there, on this machine. */
const PROBE_TIMEOUT_MS = 2_000;

/** The API version every command speaks (PLAN-37); each path is built from it. */
export const API_V1 = '/api/v1';

const RAW_V1 = /^\/(runestone|edda|groot|atlas)\/api\/v1\//;

/** True for a path under a version: the ones a server from before PLAN-37 lacks. */
function isVersioned(path: string): boolean {
  return path === API_V1 || path.startsWith(`${API_V1}/`) || RAW_V1.test(path);
}

/**
 * The path a server from before PLAN-37 answers instead: the same one without
 * its version. This is the one place the CLI names the unversioned paths
 * (allowlisted in the client's `no-unversioned-api.test.ts`), because an
 * installed CLI can be newer than the hub it talks to.
 */
export function legacyPath(path: string): string {
  if (path === API_V1 || path.startsWith(`${API_V1}/`)) return `/api${path.slice(API_V1.length)}`;
  return path.replace(RAW_V1, '/$1/api/');
}

export const LEGACY_SERVER_HINT =
  'the server predates API versioning — consider updating it (using its unversioned paths)';

type ApiVersion = 'v1' | 'legacy';

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  /** Serialized as a JSON body with the matching content-type. */
  body?: unknown;
  /** Null disables the timeout — used for transfers, which are legitimately slow. */
  timeoutMs?: number | null;
}

export interface UploadInput {
  /** Path on this machine. */
  path: string;
  /** Name to send, already basename-d. */
  name: string;
  size: number;
}

export class ApiClient {
  private current: string;
  private fallbacks: readonly string[];
  private triedFallbacks: readonly string[] = [];
  private movedFrom: string | null = null;
  /** Decided by the first versioned request of the run; null until then. */
  private version: ApiVersion | null = null;
  private probing: Promise<void> | null = null;

  /**
   * `fallbacks` are tried, once, when `baseUrl` cannot be connected to at all
   * (PLAN-39): the default `bifrost.local` that does not resolve on a machine
   * running the hub itself. Empty for an address the person chose.
   */
  constructor(
    baseUrl: string,
    private readonly device: string | null,
    fallbacks: readonly string[] = [],
  ) {
    this.current = baseUrl;
    this.fallbacks = fallbacks;
  }

  /** Where requests go: the address given, or the fallback that answered. */
  get baseUrl(): string {
    return this.current;
  }

  /** The address given, when requests moved to a fallback; otherwise null. */
  get fellBackFrom(): string | null {
    return this.movedFrom;
  }

  /** The API version this run speaks, once its first versioned request decided it. */
  get apiVersion(): ApiVersion | null {
    return this.version;
  }

  /** `path` as the server answers it: unchanged, or unversioned for a pre-PLAN-37 server. */
  wirePath(path: string): string {
    return this.version === 'legacy' && isVersioned(path) ? legacyPath(path) : path;
  }

  private decide(version: ApiVersion): void {
    if (this.version !== null) return;
    this.version = version;
    // One line per run on stderr; `note` is silent under --json.
    if (version === 'legacy') note(LEGACY_SERVER_HINT);
  }

  /**
   * Which paths this server answers (PLAN-37): `GET /api/v1/health` once per
   * run, before its first versioned request. 404 means a server from before
   * versions existed, so the rest of the run uses the unversioned paths; any
   * other answer means v1. The probe is the run's first contact, so it fails
   * the way that request would have: a refused or unresolved address moves to
   * a fallback (which decides the version there) or is reported unreachable,
   * and a timeout is reported, never retried. No address is tried twice.
   */
  private ensureVersion(): Promise<void> {
    if (this.version !== null) return Promise.resolve();
    // Shared, so the first requests of a run made together (the four-kind
    // document lookup) wait on one probe instead of sending four.
    this.probing ??= this.probeVersion().finally(() => {
      this.probing = null;
    });
    return this.probing;
  }

  private async probeVersion(): Promise<void> {
    let status: number;
    try {
      const response = await fetch(`${this.current}${API_V1}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      await response.arrayBuffer();
      status = response.status;
    } catch (error) {
      if (isConnectFailure(error) && (await this.relocate())) return;
      throw this.unreachable(error);
    }
    this.decide(status === 404 ? 'legacy' : 'v1');
  }

  /**
   * Try each fallback once; move to the first hub that answers, versioned or
   * from before PLAN-37. Spent on the first call either way, so a command
   * never probes twice.
   */
  private async relocate(): Promise<boolean> {
    const candidates = this.fallbacks;
    this.fallbacks = [];
    for (const candidate of candidates) {
      try {
        const version = await hubAt(candidate);
        if (version !== null) {
          this.movedFrom = this.current;
          this.current = candidate;
          this.decide(version);
          return true;
        }
      } catch {
        // Not there either; the next candidate, or the original error.
      }
    }
    this.triedFallbacks = candidates;
    return false;
  }

  private unreachable(error: unknown): CliError {
    return unreachable(this.current, describeTransportFailure(error), this.triedFallbacks);
  }

  url(path: string, query?: RequestOptions['query']): string {
    const url = new URL(this.wirePath(path), `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.device === null ? { ...extra } : { 'x-bifrost-device': this.device, ...extra };
  }

  /** A checked JSON call. Non-2xx becomes a worded CliError. */
  async json<T>(
    what: string,
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.send(method, path, options);
    await this.ensureOk(what, response);
    return (await response.json()) as T;
  }

  /** A checked call whose answer is only its status (204s, mostly). */
  async voidCall(
    what: string,
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<void> {
    const response = await this.send(method, path, options);
    await this.ensureOk(what, response);
    // Drain so the socket goes back to the pool rather than lingering half-read.
    await response.arrayBuffer();
  }

  /** A checked call whose body the caller streams. No timeout: transfers are slow by nature. */
  async open(what: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const response = await this.send('GET', path, { ...options, timeoutMs: null });
    await this.ensureOk(what, response);
    return response;
  }

  /**
   * An unchecked call — the caller reads the status itself. Only `/go/:slug`
   * (a deliberate 302) and `doctor`'s reachability probe want this.
   */
  async probe(path: string, init: RequestInit = {}): Promise<Response> {
    return this.send(init.method ?? 'GET', path, {}, init);
  }

  /** Raw bytes with an explicit content type — Nimbus's upload sink. */
  async postBinary<T>(what: string, path: string, body: Buffer): Promise<T> {
    const response = await this.send(
      'POST',
      path,
      { timeoutMs: null },
      {
        headers: this.headers({ 'content-type': 'application/octet-stream' }),
        body: new Uint8Array(body),
      },
    );
    await this.ensureOk(what, response);
    return (await response.json()) as T;
  }

  private async send(
    method: string,
    path: string,
    options: RequestOptions = {},
    init: RequestInit = {},
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
    const headers = this.headers(
      options.body === undefined ? {} : { 'content-type': 'application/json' },
    );
    if (isVersioned(path)) await this.ensureVersion();
    try {
      return await fetch(this.url(path, options.query), {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
        ...init,
      });
    } catch (error) {
      if (isConnectFailure(error) && (await this.relocate())) {
        return this.send(method, path, options, init);
      }
      throw this.unreachable(error);
    }
  }

  private async ensureOk(what: string, response: Response): Promise<void> {
    if (response.ok) return;
    throw await failureFor(what, response);
  }

  /**
   * A multipart upload streamed straight off disk. The content-length is
   * computed exactly from the parts, which is also what lets the server's own
   * declared-size check answer 413 before it reads a byte.
   *
   * `onProgress` is fed the *envelope* bytes written so far — headers and
   * boundaries included — which is why it is paired with `contentLength` rather
   * than the sum of the file sizes: the two differ by a few hundred bytes and a
   * bar drawn against the wrong total never reaches 100%.
   */
  async postFiles<T>(
    what: string,
    path: string,
    files: readonly UploadInput[],
    options: { query?: RequestOptions['query']; onProgress?: (sent: number, total: number) => void } = {},
  ): Promise<T> {
    if (isVersioned(path)) await this.ensureVersion();
    try {
      return await this.postFilesTo<T>(what, path, files, options);
    } catch (error) {
      // Nothing reached a server, so the whole upload starts again from the
      // first byte (the envelope reopens every file) at the fallback.
      if (error instanceof ConnectFailure && (await this.relocate())) {
        return this.postFilesTo<T>(what, path, files, options);
      }
      throw error instanceof ConnectFailure ? this.unreachable(error.cause) : error;
    }
  }

  private async postFilesTo<T>(
    what: string,
    path: string,
    files: readonly UploadInput[],
    options: { query?: RequestOptions['query']; onProgress?: (sent: number, total: number) => void },
  ): Promise<T> {
    const boundary = `----BifrostCli${crypto.randomBytes(12).toString('hex')}`;
    const parts = files.map((file) => ({
      file,
      header: Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="${multipartFilename(file.name)}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
        'utf8',
      ),
    }));
    const tail = Buffer.from(`--${boundary}--\r\n`, 'utf8');
    const contentLength =
      parts.reduce((total, part) => total + part.header.length + part.file.size + 2, 0) +
      tail.length;

    const report = options.onProgress;
    let sent = 0;
    async function* envelope(): AsyncGenerator<Buffer> {
      const emit = function* (chunk: Buffer): Generator<Buffer> {
        sent += chunk.length;
        report?.(sent, contentLength);
        yield chunk;
      };
      for (const part of parts) {
        yield* emit(part.header);
        for await (const chunk of fs.createReadStream(part.file.path)) yield* emit(chunk as Buffer);
        yield* emit(Buffer.from('\r\n', 'utf8'));
      }
      yield* emit(tail);
    }

    const target = new URL(this.url(path, options.query));
    const transport = target.protocol === 'https:' ? https : http;
    // Set when the *envelope* fails rather than the socket — a file that
    // vanished or became unreadable mid-upload. Reporting that as "couldn't
    // reach the server" would send someone debugging their network over a
    // local permissions problem.
    let readFailure: Error | null = null;
    const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = transport.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: 'POST',
          headers: this.headers({
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'content-length': String(contentLength),
          }),
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            text += chunk;
          });
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      const source = Readable.from(envelope());
      // A read failure (the file vanished mid-upload) must abort the request
      // rather than send a truncated body the server would then mis-parse.
      source.on('error', (error: Error) => {
        readFailure = error;
        request.destroy(error);
        reject(error);
      });
      source.pipe(request);
    }).catch((error: unknown) => {
      if (readFailure !== null) {
        throw new CliError(`${what} failed: couldn't read a file to send — ${readFailure.message}`);
      }
      if (isConnectFailure(error)) throw new ConnectFailure(error);
      throw this.unreachable(error);
    });

    if (answer.status < 200 || answer.status >= 300) {
      throw failureFromBody(what, answer.status, answer.body);
    }
    try {
      return JSON.parse(answer.body) as T;
    } catch {
      throw new CliError(`${what} failed: the bridge's answer was not JSON`);
    }
  }
}

/**
 * The error table. One entry per status family, each with wording a person can
 * act on and an exit code a script can branch on.
 */
export async function failureFor(what: string, response: Response): Promise<CliError> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    // A body we cannot read changes nothing — the status alone still picks the
    // message below, so there is no separate failure to report here.
  }
  return failureFromBody(what, response.status, body);
}

export function failureFromBody(what: string, status: number, body: string): CliError {
  const message = messageFromBody(body);
  if (status === 404) {
    return new CliError(`${what} failed: not found${message ? ` (${message})` : ''}`, EXIT.notFound);
  }
  if (status === 409) {
    return new CliError(`${what} failed: ${message || 'already taken'}`, EXIT.conflict);
  }
  if (status >= 500) {
    return new CliError(`${what} failed: the Bifrost server errored (HTTP ${status})`);
  }
  return new CliError(`${what} failed: ${message || `HTTP ${status}`}`);
}

/** The server's error shape is `{ error, message }`; anything else is ignored. */
function messageFromBody(body: string): string {
  if (body.length === 0) return '';
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object' && 'message' in parsed) {
      const { message } = parsed as { message?: unknown };
      if (typeof message === 'string') return message;
    }
  } catch {
    // Not JSON — an HTML error page, or a proxy's plain text. Falling through to
    // the status-only wording is right; echoing someone else's markup is not.
  }
  return '';
}

/** Turns undici's and Node's transport failures into something worth reading. */
export function describeTransportFailure(error: unknown): string {
  const named = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } };
  if (named.name === 'TimeoutError' || named.name === 'AbortError') return 'timed out';
  const code = typeof named.code === 'string' ? named.code : named.cause?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : String(error);
}

/**
 * A multipart header is a line, so a quote, backslash or newline in a name
 * would break the envelope rather than travel inside it. The server sanitizes
 * the name it stores anyway — this only keeps the transport well-formed.
 */
export function multipartFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/["\\]|[\u0000-\u001f]/g, '_');
}

/** Marks an upload that never reached a server, so `postFiles` may retry it elsewhere. */
/**
 * Whether a hub answers at `baseUrl`, and which paths it speaks: v1, the
 * unversioned ones of a server from before PLAN-37, or null for no hub.
 */
async function hubAt(baseUrl: string): Promise<ApiVersion | null> {
  const signal = (): AbortSignal => AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const v1 = await fetch(`${baseUrl}${API_V1}/health`, { signal: signal() });
  await v1.arrayBuffer();
  if (v1.ok) return 'v1';
  if (v1.status !== 404) return null;
  const old = await fetch(`${baseUrl}${legacyPath(`${API_V1}/health`)}`, { signal: signal() });
  await old.arrayBuffer();
  return old.ok ? 'legacy' : null;
}

class ConnectFailure extends Error {
  constructor(cause: unknown) {
    super('connect failure', { cause });
  }
}

/**
 * Builds the client every command uses: `--host`, then the saved default,
 * then `bifrost.local` with this machine's own addresses behind it (PLAN-39).
 */
export function clientFromOptions(options: { host?: string }): ApiClient {
  const { baseUrl, source } = resolveBaseUrl(options.host, readConfig().host);
  return new ApiClient(baseUrl, deviceId(), source === 'default' ? LOCAL_FALLBACKS : []);
}
