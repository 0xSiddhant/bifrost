import http from 'node:http';
import { Api, type ApiResponse, type DocumentKind } from '../support/api.js';
import { normaliseCaptured, TokenTable, type Captured } from './compare.js';
import { ANY_STATUS, captureResponse } from './corpus.js';

/**
 * One identical scripted write sequence, run on each side, compared after
 * normalising only the generated values (compare.ts). It covers the success
 * path and the refusals — 400, 404, 409, 413, 422 — of every write route, then
 * re-reads the lists the writes changed.
 */

interface Context {
  api: Api;
  other: Api;
  admin: Api;
  /** Ids and slugs this side minted, by the name the script gave them. */
  saved: Map<string, { id: string; slug: string }>;
}

/**
 * A step, and optionally the response keys whose values the server generated
 * for it — the relic name an unnamed document is given. Only those values, on
 * only that step, join the normaliser's token table.
 */
type Step = [label: string, run: (context: Context) => Promise<ApiResponse>, generated?: string[]];

const KINDS: DocumentKind[] = ['runestone', 'edda', 'groot', 'atlas'];
const any = { expect: ANY_STATUS };

/**
 * A POST the server answers from its `content-length` alone (a 413), before
 * reading the body. Streaming the body anyway is a race — the answer or a
 * reset of the unfinished upload, whichever the socket sees first — so this
 * sends the headers, waits for an early answer, and only sends the body if
 * none comes. Deterministic either way, which is the point of a diff.
 */
function postEarlyAnswered(api: Api, path: string, json: string): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(`${api.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(json),
        ...(api.deviceId ? { 'x-bifrost-device': api.deviceId } : {}),
      },
    });
    let answered = false;
    request.on('response', (response) => {
      answered = true;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === 'string') headers.set(key, value);
        }
        request.destroy();
        resolve({
          status: response.statusCode ?? 0,
          headers,
          bytes,
          text: () => bytes.toString('utf8'),
          json: <T>() => JSON.parse(bytes.toString('utf8')) as T,
        });
      });
    });
    request.on('error', (error) => {
      if (!answered) reject(error);
    });
    request.flushHeaders();
    setTimeout(() => {
      if (!answered) request.end(json);
    }, 1_000);
  });
}

function remember(context: Context, key: string, response: ApiResponse): ApiResponse {
  if (response.status < 300) {
    const body = response.json<{ id: string; slug: string }>();
    context.saved.set(key, { id: body.id, slug: body.slug });
  }
  return response;
}

function saved(context: Context, key: string): { id: string; slug: string } {
  return context.saved.get(key) ?? { id: 'missing', slug: 'missing' };
}

function documentSteps(kind: DocumentKind): Step[] {
  const valid =
    kind === 'runestone'
      ? '{"written":"by the diff"}'
      : kind === 'groot'
        ? 'written: by the diff\n'
        : kind === 'atlas'
          ? '<w>by the diff</w>\n'
          : '# Written by the diff\n';
  return [
    [
      `POST /api/${kind} (named)`,
      async (c) =>
        remember(
          c,
          `${kind}:a`,
          await c.api.post(`/api/${kind}`, { name: 'Diff write Ä', content: valid }, any),
        ),
    ],
    [
      `POST /api/${kind} (unnamed)`,
      async (c) =>
        remember(c, `${kind}:b`, await c.other.post(`/api/${kind}`, { content: valid }, any)),
      ['name'],
    ],
    [`POST /api/${kind} (no body)`, (c) => c.api.post(`/api/${kind}`, {}, any)],
    [
      `POST /api/${kind} (empty content)`,
      (c) => c.api.post(`/api/${kind}`, { content: '' }, any),
      ['name'],
    ],
    [
      // Over the 2048 KB cap, so every build refuses it and nothing is saved.
      // (Until PLAN-33 a 1.2 MB document was refused too, by Fastify's 1 MiB
      // default body limit; it now saves, which the 413 path no longer tests.)
      `POST /api/${kind} (over the cap)`,
      (c) =>
        postEarlyAnswered(
          c.api,
          `/api/${kind}`,
          JSON.stringify({
            content:
              kind === 'runestone' ? `{"pad":"${'x'.repeat(2_100_000)}"}` : 'x'.repeat(2_100_000),
          }),
        ),
    ],
    [
      `PUT /api/${kind}/:id (rename)`,
      (c) =>
        c.api.put(`/api/${kind}/${saved(c, `${kind}:a`).id}`, { name: 'Diff write renamed' }, any),
    ],
    [
      `PUT /api/${kind}/:id (content)`,
      (c) =>
        c.api.put(
          `/api/${kind}/${saved(c, `${kind}:a`).id}`,
          { content: valid.replace('diff', 'diff, twice') },
          any,
        ),
    ],
    [
      `PUT /api/${kind}/:id (empty)`,
      (c) => c.api.put(`/api/${kind}/${saved(c, `${kind}:a`).id}`, {}, any),
    ],
    [`PUT /api/${kind}/missing`, (c) => c.api.put(`/api/${kind}/zzzzzz`, { name: 'x' }, any)],
    [
      `GET /api/${kind}/:old-slug`,
      (c) => c.api.get(`/api/${kind}/${saved(c, `${kind}:a`).slug}`, any),
    ],
    [
      `DELETE /api/${kind}/:id`,
      (c) => c.api.delete(`/api/${kind}/${saved(c, `${kind}:b`).id}`, any),
    ],
    [
      `DELETE /api/${kind}/:id (again)`,
      (c) => c.api.delete(`/api/${kind}/${saved(c, `${kind}:b`).id}`, any),
    ],
  ];
}

const STEPS: Step[] = [
  ...KINDS.flatMap(documentSteps),
  [
    'POST /api/runestone (invalid JSON)',
    (c) => c.api.post('/api/runestone', { content: '{"open":' }, any),
  ],

  [
    'POST /api/accio',
    async (c) =>
      remember(
        c,
        'accio',
        await c.api.post(
          '/api/accio',
          { url: 'https://example.invalid/diff', title: 'Diff link', tags: ['diff', 'Ünï'] },
          any,
        ),
      ),
  ],
  [
    'POST /api/accio (javascript:)',
    (c) => c.api.post('/api/accio', { url: 'javascript:alert(1)' }, any),
  ],
  ['POST /api/accio (no url)', (c) => c.api.post('/api/accio', {}, any)],
  [
    'PATCH /api/accio/:id (clear title)',
    (c) => c.api.patch(`/api/accio/${saved(c, 'accio').id}`, { title: '' }, any),
  ],
  [
    'PATCH /api/accio/:id (tags)',
    (c) => c.api.patch(`/api/accio/${saved(c, 'accio').id}`, { tags: ['retagged'] }, any),
  ],
  ['PATCH /api/accio/missing', (c) => c.api.patch('/api/accio/zzzzzz', { title: 'x' }, any)],
  ['DELETE /api/accio/:id', (c) => c.api.delete(`/api/accio/${saved(c, 'accio').id}`, any)],
  ['DELETE /api/accio/:id (again)', (c) => c.api.delete(`/api/accio/${saved(c, 'accio').id}`, any)],

  [
    'POST /api/portkey',
    (c) => c.api.post('/api/portkey', { slug: 'diff-hall', url: '10.0.0.200', note: 'diff' }, any),
  ],
  [
    'POST /api/portkey (taken)',
    (c) => c.api.post('/api/portkey', { slug: 'diff-hall', url: 'http://10.0.0.201' }, any),
  ],
  [
    'POST /api/portkey (reserved)',
    (c) => c.api.post('/api/portkey', { slug: 'api', url: 'http://10.0.0.201' }, any),
  ],
  [
    'POST /api/portkey (bad slug)',
    (c) => c.api.post('/api/portkey', { slug: 'Not A Slug', url: 'http://10.0.0.201' }, any),
  ],
  [
    'POST /api/portkey (ftp target)',
    (c) => c.api.post('/api/portkey', { slug: 'diff-ftp', url: 'ftp://10.0.0.2' }, any),
  ],
  [
    'PATCH /api/portkey/:slug',
    (c) => c.api.patch('/api/portkey/diff-hall', { url: 'http://10.0.0.202/x', note: '' }, any),
  ],
  ['GET /go/diff-hall', (c) => c.api.get('/go/diff-hall', any)],
  ['DELETE /api/portkey/:slug', (c) => c.api.delete('/api/portkey/diff-hall', any)],
  ['DELETE /api/portkey/:slug (again)', (c) => c.api.delete('/api/portkey/diff-hall', any)],

  [
    'POST /api/clipboard',
    async (c) =>
      remember(
        c,
        'clip',
        await c.api.post('/api/clipboard', { text: 'diff clip Ä', ttlSeconds: 600 }, any),
      ),
  ],
  [
    'POST /api/clipboard (code)',
    (c) => c.api.post('/api/clipboard', { text: 'let x = 1', kind: 'code', lang: 'js' }, any),
  ],
  [
    'POST /api/clipboard (over cap)',
    (c) => c.api.post('/api/clipboard', { text: 'x'.repeat(70 * 1024) }, any),
  ],
  ['POST /api/clipboard (empty)', (c) => c.api.post('/api/clipboard', { text: '' }, any)],
  ['DELETE /api/clipboard/:id', (c) => c.api.delete(`/api/clipboard/${saved(c, 'clip').id}`, any)],

  [
    'POST /api/files',
    (c) =>
      c.api.upload(
        [
          { name: 'diff upload.txt', content: 'diff' },
          { name: 'tool.exe', content: 'MZ' },
        ],
        '',
        any,
      ),
  ],
  [
    'POST /api/files (collision)',
    (c) => c.api.upload([{ name: 'diff upload.txt', content: 'again' }], '', any),
  ],
  [
    'PATCH /api/files/:name (unsanitary)',
    (c) =>
      c.api.patch(`/api/files/${encodeURIComponent('diff upload.txt')}`, { name: 'a/b.txt' }, any),
  ],
  [
    'PATCH /api/files/:name',
    (c) =>
      c.api.patch(
        `/api/files/${encodeURIComponent('diff upload.txt')}`,
        { name: 'diff renamed.txt' },
        any,
      ),
  ],
  [
    'PATCH /api/files/missing',
    (c) => c.api.patch('/api/files/missing.txt', { name: 'x.txt' }, any),
  ],
  [
    'POST /api/files/:name/publish',
    (c) =>
      c.api.post(`/api/files/${encodeURIComponent('diff renamed.txt')}/publish`, undefined, any),
  ],
  [
    'DELETE /api/files/:name',
    (c) => c.api.delete(`/api/files/${encodeURIComponent('diff upload-1.txt')}`, any),
  ],
  ['DELETE /api/files/missing', (c) => c.api.delete('/api/files/missing.txt', any)],
  [
    'POST /api/files?folder=',
    (c) => c.api.upload([{ name: 'in folder.txt', content: 'f' }], '?folder=Diff%20Folder', any),
  ],
  [
    'POST /api/files?folder= (a file)',
    (c) => c.api.upload([{ name: 'x.txt', content: 'x' }], '?folder=published.txt', any),
  ],

  [
    'POST /api/brotli/compress',
    (c) =>
      c.api.request('POST', '/api/brotli/compress?quality=best', {
        body: Buffer.from('the same bytes every time '.repeat(200)),
        headers: { 'content-type': 'application/octet-stream' },
        expect: ANY_STATUS,
      }),
  ],
  [
    'POST /api/brotli/decompress (garbage)',
    (c) =>
      c.api.request('POST', '/api/brotli/decompress', {
        body: Buffer.from('not brotli at all'),
        headers: { 'content-type': 'application/octet-stream' },
        expect: ANY_STATUS,
      }),
  ],
  [
    'POST /api/brotli/decompress',
    async (c) => {
      const compressed = await c.api.request('POST', '/api/brotli/compress', {
        body: Buffer.from('round trip'),
        headers: { 'content-type': 'application/octet-stream' },
      });
      return c.api.request('POST', '/api/brotli/decompress', {
        body: compressed.bytes,
        headers: { 'content-type': 'application/octet-stream' },
        expect: ANY_STATUS,
      });
    },
  ],

  [
    'POST /api/nimbus/results',
    (c) =>
      c.api.post('/api/nimbus/results', { downMbps: 10, upMbps: 9, latencyMs: 2, testMb: 10 }, any),
  ],
  [
    'POST /api/nimbus/results (invalid)',
    (c) => c.api.post('/api/nimbus/results', { downMbps: 'fast' }, any),
  ],
  ['POST /api/nimbus/release', (c) => c.api.post('/api/nimbus/release', undefined, any)],
  [
    'POST /api/client-logs',
    (c) =>
      c.api.post(
        '/api/client-logs',
        { entries: [{ level: 'warn', message: 'diff', module: 'diff' }] },
        any,
      ),
  ],
  [
    'POST /api/client-logs (invalid)',
    (c) => c.api.post('/api/client-logs', { entries: 'no' }, any),
  ],
  [
    'PATCH /api/presence/name',
    (c) => c.api.patch('/api/presence/name', { deviceId: 'diff-device-a', name: 'Diff Hall' }, any),
  ],

  [
    'POST /api/heimdall/login (wrong)',
    (c) => new Api(c.api.baseUrl, null).post('/api/heimdall/login', { pin: 'wrong-pin' }, any),
  ],
  [
    'PATCH /api/heimdall/settings',
    (c) => c.admin.patch('/api/heimdall/settings', { tapCount: 6 }, any),
  ],
  [
    'PATCH /api/heimdall/settings (no session)',
    (c) => c.api.patch('/api/heimdall/settings', { tapCount: 6 }, any),
  ],
  ['POST /api/themes (invalid)', (c) => c.admin.post('/api/themes', { id: 'broken' }, any)],
  ['PATCH /api/themes/:id', (c) => c.admin.patch('/api/themes/tokyo', { enabled: true }, any)],
  ['DELETE /api/themes/:id', (c) => c.admin.delete('/api/themes/diff-frost', any)],
  ['DELETE /api/themes/:id (built-in)', (c) => c.admin.delete('/api/themes/aurora', any)],
  [
    'PATCH /api/loki/settings',
    (c) => c.admin.patch('/api/loki/settings', { executionEnabled: false }, any),
  ],
  [
    'PATCH /api/screensaver/settings',
    (c) => c.admin.patch('/api/screensaver/settings', { enabled: false }, any),
  ],
  [
    'PATCH /api/offline-mode/settings',
    (c) => c.admin.patch('/api/offline-mode/settings', { id: 'nope', enabled: false }, any),
  ],
];

/** The lists the writes changed, read back after them. */
const AFTER = [
  '/api/runestone',
  '/api/edda',
  '/api/groot',
  '/api/atlas',
  '/api/accio',
  '/api/portkey',
  '/api/clipboard',
  '/api/downloads',
  '/api/nimbus/results',
  '/api/themes',
];
const AFTER_ADMIN = [
  '/api/heimdall/uploads',
  '/api/heimdall/settings',
  '/api/themes/manage',
  '/api/heimdall/audit?limit=100',
];

export async function runWrites(baseUrl: string, admin: Api): Promise<Captured[]> {
  const context: Context = {
    api: new Api(baseUrl, 'diff-writer'),
    other: new Api(baseUrl, null),
    admin,
    saved: new Map(),
  };
  const table = new TokenTable();
  const out: Captured[] = [];
  for (const [label, run, generated = []] of STEPS) {
    const response = await run(context);
    if (generated.length > 0 && response.status < 300) {
      const body = response.json<Record<string, unknown>>();
      for (const key of generated) {
        if (typeof body[key] === 'string') table.learn(body[key], key);
      }
    }
    out.push(normaliseCaptured(captureResponse(label, response), table));
  }
  // Background work the writes started (watcher rows, the publish) settles first.
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  for (const path of AFTER)
    out.push(
      normaliseCaptured(
        captureResponse(`GET ${path} (after writes)`, await context.api.get(path, any)),
        table,
      ),
    );
  for (const path of AFTER_ADMIN)
    out.push(
      normaliseCaptured(
        captureResponse(`GET ${path} [admin] (after writes)`, await admin.get(path, any)),
        table,
      ),
    );
  return out;
}
