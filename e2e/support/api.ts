/**
 * A thin HTTP client for seeding and for reading state back — **through the
 * API only**, exactly as a browser or the CLI would, never by writing to the
 * server's database or storage behind its back.
 */

export interface ApiResponse {
  status: number;
  headers: Headers;
  bytes: Buffer;
  text(): string;
  json<T = unknown>(): T;
}

export interface RequestOptions {
  json?: unknown;
  /** A raw body; a Buffer is sent as its bytes. */
  body?: BodyInit | Buffer;
  headers?: Record<string, string>;
  /** Statuses that do not throw. Default: any 2xx/3xx. */
  expect?: number[];
}

export class Api {
  /** The admin session cookie, once `login()` has run. */
  cookie: string | null = null;

  constructor(
    readonly baseUrl: string,
    /** The `x-bifrost-device` id rows are authored under. */
    readonly deviceId: string | null = 'e2e-seed-device',
  ) {}

  async request(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse> {
    const headers: Record<string, string> = { ...options.headers };
    if (this.deviceId) headers['x-bifrost-device'] = this.deviceId;
    if (this.cookie) headers.cookie = this.cookie;
    let body: BodyInit | undefined = Buffer.isBuffer(options.body)
      ? new Uint8Array(options.body)
      : options.body;
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
      redirect: 'manual',
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const result: ApiResponse = {
      status: response.status,
      headers: response.headers,
      bytes,
      text: () => bytes.toString('utf8'),
      json: <T>() => JSON.parse(bytes.toString('utf8')) as T,
    };
    const ok = options.expect ? options.expect.includes(response.status) : response.status < 400;
    if (!ok) {
      throw new Error(`${method} ${path} → ${response.status}: ${result.text().slice(0, 300)}`);
    }
    return result;
  }

  get(path: string, options?: RequestOptions) {
    return this.request('GET', path, options);
  }
  post(path: string, json?: unknown, options: RequestOptions = {}) {
    return this.request('POST', path, { ...options, json });
  }
  put(path: string, json: unknown, options: RequestOptions = {}) {
    return this.request('PUT', path, { ...options, json });
  }
  patch(path: string, json: unknown, options: RequestOptions = {}) {
    return this.request('PATCH', path, { ...options, json });
  }
  delete(path: string, options?: RequestOptions) {
    return this.request('DELETE', path, options);
  }

  /** Open an admin session; later calls carry its cookie. */
  async login(pin: string): Promise<this> {
    const response = await this.post('/api/v1/heimdall/login', { pin });
    const setCookie = response.headers.getSetCookie();
    this.cookie = setCookie.map((line) => line.split(';')[0]).join('; ');
    return this;
  }

  /** Multipart upload, the shape `POST /api/files` takes from a browser. */
  async upload(
    files: { name: string; content: string | Buffer }[],
    query = '',
    options: Pick<RequestOptions, 'expect'> = {},
  ): Promise<ApiResponse> {
    const form = new FormData();
    for (const file of files) {
      const content = typeof file.content === 'string' ? Buffer.from(file.content) : file.content;
      form.append('files', new Blob([new Uint8Array(content)]), file.name);
    }
    return this.request('POST', `/api/v1/files${query}`, { body: form, ...options });
  }
}

export type DocumentKind = 'runestone' | 'edda' | 'groot' | 'atlas';

export interface SavedDocument {
  id: string;
  slug: string;
  name: string;
}

export async function saveDocument(
  api: Api,
  kind: DocumentKind,
  content: string,
  name?: string,
): Promise<SavedDocument> {
  const response = await api.post(
    `/api/v1/${kind}`,
    name === undefined ? { content } : { name, content },
  );
  return response.json<SavedDocument>();
}
