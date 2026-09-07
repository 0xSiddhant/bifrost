import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { deviceId, readConfig } from './config.js';
import { resolveBaseUrl, unreachable } from './discover.js';
import { CliError, EXIT } from './output.js';

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
  constructor(
    readonly baseUrl: string,
    private readonly device: string | null,
  ) {}

  url(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path, `${this.baseUrl}/`);
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
    try {
      return await fetch(this.url(path, options.query), {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
        ...init,
      });
    } catch (error) {
      throw unreachable(this.baseUrl, describeTransportFailure(error));
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
   */
  async postFiles<T>(what: string, path: string, files: readonly UploadInput[]): Promise<T> {
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

    async function* envelope(): AsyncGenerator<Buffer> {
      for (const part of parts) {
        yield part.header;
        for await (const chunk of fs.createReadStream(part.file.path)) yield chunk as Buffer;
        yield Buffer.from('\r\n', 'utf8');
      }
      yield tail;
    }

    const target = new URL(this.url(path));
    const transport = target.protocol === 'https:' ? https : http;
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
        request.destroy(error);
        reject(error);
      });
      source.pipe(request);
    }).catch((error: unknown) => {
      throw unreachable(this.baseUrl, describeTransportFailure(error));
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

/** Builds the client every command uses: `--host`, then the saved default. */
export function clientFromOptions(options: { host?: string }): ApiClient {
  const { baseUrl } = resolveBaseUrl(options.host, readConfig().host);
  return new ApiClient(baseUrl, deviceId());
}
