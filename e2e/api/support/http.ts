import fs from 'node:fs';
import path from 'node:path';
import { loadSpec, type Operation, type Spec } from './spec.js';

/**
 * The API suite's HTTP client (PLAN-33): Node's own `fetch` against the built
 * server, nothing in between. Every response it receives goes through one
 * `Recorder`, which checks it against `server/openapi.json` on the spot and
 * keeps what the end-of-file checks need: contract problems, which operations
 * ever succeeded (the coverage report), and the body text for the hygiene scan.
 */

export interface Recorded {
  method: string;
  path: string;
  status: number;
  operationId: string | null;
  /** The first 256 KiB of the body as text — enough for any path or stack frame to show. */
  text: string;
  headers: Headers;
}

export interface RecordedResponse extends Recorded {
  bytes: Buffer;
  json<T = unknown>(): T;
}

/** What a suite file leaves for the run-wide coverage report. */
export interface RecordFile {
  suite: string;
  covered: string[];
}

const KEEP_TEXT = 256 * 1024;

export class Recorder {
  readonly spec: Spec = loadSpec();
  readonly responses: Recorded[] = [];
  readonly problems: string[] = [];
  readonly covered = new Set<string>();
  /** Requests to no operation in the spec (the SPA fallback, assets, a deliberate `/api/nope`). */
  readonly unmatched: string[] = [];

  record(entry: Recorded, { contract = true }: { contract?: boolean } = {}): void {
    this.responses.push(entry);
    const pathname = entry.path.split('?')[0] ?? entry.path;
    const op = this.spec.find(entry.method, pathname);
    if (!op) {
      this.unmatched.push(`${entry.method} ${entry.path} → ${entry.status}`);
      return;
    }
    entry.operationId = op.operationId;
    if (this.spec.isSuccess(op, entry.status)) this.covered.add(op.operationId);
    if (!contract) return;
    const problem = this.spec.check(
      op,
      entry.method,
      entry.status,
      entry.headers.get('content-type') ?? '',
      entry.text,
    );
    if (problem)
      this.problems.push(`${entry.method} ${entry.path} (${op.operationId}): ${problem}`);
  }

  /** Leave this file's coverage for the run-wide report (see coverage-report.ts). */
  flush(suite: string, dir: string | undefined): void {
    if (!dir) return;
    const record: RecordFile = { suite, covered: [...this.covered] };
    fs.writeFileSync(path.join(dir, `${suite}-${process.pid}.json`), JSON.stringify(record));
  }
}

export interface RequestOptions {
  json?: unknown;
  body?: BodyInit | Buffer;
  headers?: Record<string, string>;
  /** Skip the cookie jar for this request. */
  anonymous?: boolean;
  /** Record the status for coverage but skip the contract check (a deliberate oddity). */
  contract?: boolean;
  signal?: AbortSignal;
}

export class Client {
  /** The admin session cookie, if logged in. */
  cookie: string | null = null;

  constructor(
    readonly baseUrl: string,
    readonly recorder: Recorder,
    readonly deviceId: string | null = 'e2e-api-device',
  ) {}

  async request(
    method: string,
    url: string,
    options: RequestOptions = {},
  ): Promise<RecordedResponse> {
    const headers: Record<string, string> = { ...options.headers };
    if (this.deviceId && !('x-bifrost-device' in headers))
      headers['x-bifrost-device'] = this.deviceId;
    if (this.cookie && !options.anonymous && !('cookie' in headers)) headers.cookie = this.cookie;
    let body: BodyInit | undefined = Buffer.isBuffer(options.body)
      ? new Uint8Array(options.body)
      : options.body;
    if (options.json !== undefined) {
      headers['content-type'] ??= 'application/json';
      body = JSON.stringify(options.json);
    }
    const response = await fetch(`${this.baseUrl}${url}`, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: options.signal,
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const entry: Recorded = {
      method,
      path: url,
      status: response.status,
      operationId: null,
      text: bytes.subarray(0, KEEP_TEXT).toString('utf8'),
      headers: response.headers,
    };
    this.recorder.record(entry, { contract: options.contract ?? true });
    return {
      ...entry,
      bytes,
      json: <T>() => JSON.parse(bytes.toString('utf8')) as T,
    };
  }

  get(url: string, options?: RequestOptions) {
    return this.request('GET', url, options);
  }
  post(url: string, json?: unknown, options: RequestOptions = {}) {
    return this.request('POST', url, json === undefined ? options : { ...options, json });
  }
  put(url: string, json: unknown, options: RequestOptions = {}) {
    return this.request('PUT', url, { ...options, json });
  }
  patch(url: string, json: unknown, options: RequestOptions = {}) {
    return this.request('PATCH', url, { ...options, json });
  }
  delete(url: string, options?: RequestOptions) {
    return this.request('DELETE', url, options);
  }

  /** Log in with the PIN; later requests carry the session cookie. */
  async login(pin: string): Promise<this> {
    const response = await this.post('/api/heimdall/login', { pin });
    if (response.status !== 200) throw new Error(`login → ${response.status}: ${response.text}`);
    this.cookie = response.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    return this;
  }

  /** A multipart upload, the shape `POST /api/files` takes from a browser. */
  upload(files: { name: string; content: string | Buffer }[], query = '') {
    const form = new FormData();
    for (const file of files) {
      const content = typeof file.content === 'string' ? Buffer.from(file.content) : file.content;
      form.append('files', new Blob([new Uint8Array(content)]), file.name);
    }
    return this.request('POST', `/api/files${query}`, { body: form });
  }
}

/** The operation a recorded response belongs to, for assertions that need it. */
export function operationOf(recorder: Recorder, response: Recorded): Operation | undefined {
  return response.operationId ? recorder.spec.byId(response.operationId) : undefined;
}
