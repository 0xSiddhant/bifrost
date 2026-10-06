import type { Api, ApiResponse, DocumentKind } from '../support/api.js';
import { COMPARED_HEADERS, type Captured } from './compare.js';
import type { Seeded } from './seed.js';

/**
 * The read corpus: every read route with every query shape — all sorts ×
 * orders × filters, legacy and `paged=true`, cursors walked to the end, every
 * record by slug and by stale slug, raw endpoints, `?download`, file content
 * as an attachment and `?inline=1`, and the admin reads with and without a
 * session. Discovered from the base side once and replayed, request for
 * request, against both.
 */

export interface ReadRequest {
  path: string;
  /** Sent with the admin session cookie. */
  admin?: boolean;
}

/**
 * Endpoints that differ between two healthy servers by nature, never by code.
 * Each is excluded with its reason rather than "normalised", so the corpus
 * check (PLAN-32c) can still see they were considered.
 */
export const EXCLUDED: { path: string; reason: string }[] = [
  { path: '/metrics', reason: 'runtime gauges (CPU, memory, event-loop lag) of this process' },
  { path: '/api/events', reason: 'an endless SSE stream, not a response' },
  { path: '/api/heimdall/stats', reason: 'uptime and live counters' },
  {
    path: '/api/heimdall/about',
    reason: 'the build stamp: each build’s own commit and build date',
  },
  { path: '/api/presence', reason: 'connection times and online state of whoever is connected' },
  {
    path: '/api/health',
    reason: 'process uptime (logged addition to the plan’s list, same kind as stats)',
  },
  {
    path: '/api/nimbus/down',
    reason: 'a random payload pool generated at each boot (logged addition to the plan’s list)',
  },
];

const KINDS: DocumentKind[] = ['runestone', 'edda', 'groot', 'atlas'];
const DOC_SORTS = ['name', 'created', 'modified', 'size'];
const ORDERS = ['asc', 'desc'];

interface DocSummary {
  slug: string;
  name: string;
  authorDeviceId: string | null;
}
interface DownloadEntry {
  id: string;
  type: 'file' | 'folder';
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined) as [
    string,
    string | number | boolean,
  ][];
  return entries.length === 0
    ? ''
    : `?${entries.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')}`;
}

async function walkCursor(
  api: Api,
  base: string,
  params: Record<string, string | number | boolean | undefined>,
  out: ReadRequest[],
): Promise<void> {
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const path = `${base}${query({ ...params, paged: true, cursor })}`;
    out.push({ path });
    const body = (await api.get(path)).json<{ nextCursor?: string | null }>();
    if (!body.nextCursor) return;
    cursor = body.nextCursor;
  }
}

export async function discoverCorpus(api: Api, seeded: Seeded | null): Promise<ReadRequest[]> {
  const out: ReadRequest[] = [];
  const add = (path: string, admin = false) => out.push({ path, admin });

  for (const path of [
    '/api/capabilities',
    '/api/files/config',
    '/api/qr/server-url',
    '/api/themes',
    '/api/clipboard',
    '/api/client-logs/config',
    '/api/loki/config',
    '/api/brotli/config',
    '/api/nimbus/config',
    '/api/nimbus/ping',
    '/api/nimbus/results',
    '/api/nimbus/results?device=diff-device-a',
    '/api/nimbus/results?limit=1',
    '/api/screensaver/config',
    '/api/offline-mode/config',
    '/api/heimdall/access',
    '/api/heimdall/changelog',
  ]) {
    add(path);
  }
  for (const path of [
    '/api/heimdall/session',
    '/api/heimdall/changelog',
    '/api/heimdall/settings',
    '/api/themes/manage',
    '/api/heimdall/uploads',
    '/api/heimdall/uploads?limit=1&offset=1',
    '/api/heimdall/audit',
    '/api/heimdall/audit?limit=5',
    '/api/heimdall/audit?limit=5&offset=5',
    '/api/heimdall/audit?event=accio.saved',
    '/api/heimdall/audit?event=file.uploaded',
  ]) {
    add(path, true);
  }
  // The same admin reads without a session: the 401 is part of the contract.
  for (const path of ['/api/heimdall/settings', '/api/heimdall/audit', '/api/themes/manage'])
    add(path);

  const themes = (await api.get('/api/themes')).json<{ themes: { id: string }[] }>().themes;
  for (const theme of themes) add(`/api/themes/${theme.id}`);
  add('/api/themes/no-such-theme');

  // Documents: config, every list shape, every record, stale slugs, raw bytes.
  for (const kind of KINDS) {
    add(`/api/${kind}/config`);
    const all = (await api.get(`/api/${kind}?limit=500`)).json<DocSummary[]>();
    const authors = [
      ...new Set(all.map((doc) => doc.authorDeviceId).filter((id): id is string => id !== null)),
    ].sort();
    add(`/api/${kind}`);
    for (const sort of DOC_SORTS) {
      for (const order of ORDERS) {
        add(`/api/${kind}${query({ sort, order })}`);
        for (let offset = 0; offset < all.length + 7; offset += 7)
          add(`/api/${kind}${query({ sort, order, paged: true, limit: 7, offset })}`);
      }
    }
    for (const q of ['renamed', 'Völ', 'ᚱ', 'zzz-nothing']) {
      add(`/api/${kind}${query({ q })}`);
      add(`/api/${kind}${query({ q, paged: true })}`);
    }
    for (const author of authors) {
      add(`/api/${kind}${query({ author })}`);
      add(`/api/${kind}${query({ author, paged: true, limit: 5 })}`);
    }
    add(`/api/${kind}${query({ paged: true })}`);
    add(`/api/${kind}${query({ limit: 3, offset: 2 })}`);
    for (const doc of all) {
      add(`/api/${kind}/${doc.slug}`);
      add(`/${kind}/api/${doc.slug}`);
      add(`/${kind}/api/${doc.slug}?download=1`);
    }
    for (const stale of seeded?.staleSlugs[kind] ?? []) {
      add(`/api/${kind}/${stale}`);
      add(`/${kind}/api/${stale}`);
    }
    add(`/api/${kind}/no-such-slug-zzzzzz`);
    add(`/${kind}/api/no-such-slug-zzzzzz`);
  }

  // Accio and Portkey: legacy lists, filters, and every cursor walked to the end.
  add('/api/accio');
  for (const sort of ['created', 'title', 'url']) {
    for (const order of ORDERS) {
      add(`/api/accio${query({ sort, order })}`);
      await walkCursor(api, '/api/accio', { sort, order, limit: 6 }, out);
    }
  }
  const accioTags = (await api.get('/api/accio?paged=true')).json<{ tags?: string[] }>().tags ?? [];
  for (const tag of accioTags) {
    add(`/api/accio${query({ tag })}`);
    await walkCursor(api, '/api/accio', { tag, limit: 4 }, out);
  }
  for (const q of ['link', 'Ünï', 'example.invalid/shelf/1', 'zzz-nothing']) {
    add(`/api/accio${query({ q })}`);
    await walkCursor(api, '/api/accio', { q, limit: 5 }, out);
  }
  add('/api/portkey');
  add('/api/portkey?limit=5&offset=5');
  await walkCursor(api, '/api/portkey', { limit: 7 }, out);
  for (const q of ['link-0', 'stairs', 'zzz-nothing']) {
    add(`/api/portkey${query({ q })}`);
    await walkCursor(api, '/api/portkey', { q, limit: 3 }, out);
  }

  // Files: staged uploads and the downloads tree, by every route that reads them.
  add('/api/downloads');
  const downloads = (await api.get('/api/downloads')).json<DownloadEntry[]>();
  for (const entry of downloads) {
    if (entry.type === 'folder') {
      add(`/api/downloads/${entry.id}/archive`);
      add(`/api/downloads/${entry.id}/content`);
    } else {
      add(`/api/downloads/${entry.id}/content`);
      // `inline=1` swaps the attachment headers for a browser preview's.
      add(`/api/downloads/${entry.id}/content?inline=1`);
      add(`/api/downloads/${entry.id}/meta`);
      add(`/api/downloads/${entry.id}/archive`);
    }
  }
  add('/api/downloads/no-such-id/content');
  for (const name of ['staged notes.txt', 'Völuspá.md', 'data.json', 'missing.txt']) {
    add(`/api/files/${encodeURIComponent(name)}/preview`);
    add(`/api/files/${encodeURIComponent(name)}/content`);
    add(`/api/files/${encodeURIComponent(name)}/content?inline=1`);
  }

  // Go-links last: following one is a read with a side effect (the hit count).
  add('/go/link-03');
  add('/go/no-such-link');
  return out;
}

/** Every status is an answer worth comparing — a 404 or a 401 is contract too. */
export const ANY_STATUS = [...Array(600).keys()];

export function captureResponse(label: string, response: ApiResponse): Captured {
  const headers: Record<string, string> = {};
  for (const name of COMPARED_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return { request: label, status: response.status, headers, body: response.bytes };
}

export async function replay(api: Api, admin: Api, requests: ReadRequest[]): Promise<Captured[]> {
  const captured: Captured[] = [];
  for (const request of requests) {
    const response = await (request.admin ? admin : api).request('GET', request.path, {
      expect: ANY_STATUS,
    });
    captured.push(
      captureResponse(`GET ${request.path}${request.admin ? ' [admin]' : ''}`, response),
    );
  }
  return captured;
}
