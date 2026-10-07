import type { Api } from '../support/api.js';

/**
 * The volume a load run pages against (PLAN-34), created through the public
 * API only, as PLAN-33 does: if something cannot be seeded over HTTP, no
 * client can create it either. Seeding is timed, and its own throughput is
 * the first number in the report.
 */

export const DOCUMENT_KINDS = ['runestone', 'edda', 'groot', 'atlas'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface SeedPlan {
  documents: number;
  accio: number;
  portkey: number;
  downloadFiles: number;
  downloadFolders: number;
}

/** The plan's set: realistic volumes, so lists page instead of answering empty tables. */
export const FULL_SEED: SeedPlan = {
  documents: 2_000,
  accio: 1_000,
  portkey: 500,
  downloadFiles: 20,
  downloadFolders: 2,
};

export interface Seeded {
  slugs: Record<DocumentKind, string[]>;
  portkeySlugs: string[];
  downloadFileIds: string[];
  downloadFolderIds: string[];
  requests: number;
  seconds: number;
}

const WORDS =
  'the bridge holds every realm of the nine worlds and the ash tree yggdrasil keeps watch over them all'.split(
    ' ',
  );

/** Prose of exactly `bytes` ASCII bytes, broken into lines: never one giant token. */
export function prose(bytes: number, seed: number): string {
  let text = '';
  let index = seed;
  while (text.length < bytes) {
    const line: string[] = [];
    while (line.join(' ').length < 72) line.push(WORDS[index++ % WORDS.length] ?? 'saga');
    text += `${line.join(' ')}\n`;
  }
  return text.slice(0, bytes);
}

/**
 * A valid document of about `bytes` bytes in its kind's format. The body is
 * prose wrapped in the format's own syntax, so every editor and the server's
 * validation see a document a person could have written.
 */
export function documentOf(kind: DocumentKind, bytes: number, seed: number): string {
  const body = prose(Math.max(16, bytes - 64), seed);
  switch (kind) {
    case 'runestone':
      return `${JSON.stringify({ seed, lines: body.split('\n') }, null, 2)}\n`;
    case 'edda':
      return `# Saga ${seed}\n\n${body.replace(/\n/g, '\n\n')}`;
    case 'groot':
      return `seed: ${seed}\nlines:\n${body
        .split('\n')
        .filter(Boolean)
        .map((line) => `  - ${line}`)
        .join('\n')}\n`;
    case 'atlas':
      return `<?xml version="1.0" encoding="UTF-8"?>\n<saga seed="${seed}">\n${body
        .split('\n')
        .filter(Boolean)
        .map((line) => `  <line>${line}</line>`)
        .join('\n')}\n</saga>\n`;
  }
}

/**
 * Log-uniform between 1 KB and 200 KB, deterministic per index: most
 * documents are small, a few are large, as in a real Pensieve.
 */
export function documentSize(index: number): number {
  const unit = ((index * 2654435761) % 2 ** 32) / 2 ** 32;
  return Math.round(1024 * 200 ** unit);
}

/** Run `task` over `items` with at most `limit` in flight. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface DownloadEntry {
  id: string;
  name: string;
  type: 'file' | 'folder';
  parent: string | null;
}

async function waitForDownloads(api: Api, names: Set<string>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entries = (await api.get('/api/downloads')).json<DownloadEntry[]>();
    const found = entries.filter((entry) => names.has(entry.name));
    if (found.length === names.size) return found;
    if (Date.now() > deadline) {
      throw new Error(`only ${found.length} of ${names.size} downloads were ever listed`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function seed(api: Api, plan: SeedPlan = FULL_SEED): Promise<Seeded> {
  const started = Date.now();
  let requests = 0;
  const tag = started.toString(36);
  const slugs = Object.fromEntries(DOCUMENT_KINDS.map((kind) => [kind, [] as string[]])) as Record<
    DocumentKind,
    string[]
  >;

  await pool(
    Array.from({ length: plan.documents }, (_, index) => index),
    16,
    async (index) => {
      const kind = DOCUMENT_KINDS[index % DOCUMENT_KINDS.length] ?? 'runestone';
      const response = await api.post(`/api/${kind}`, {
        name: `Load ${kind} ${tag} ${index}`,
        content: documentOf(kind, documentSize(index), index),
      });
      requests += 1;
      slugs[kind].push(response.json<{ slug: string }>().slug);
    },
  );

  await pool(
    Array.from({ length: plan.accio }, (_, index) => index),
    16,
    async (index) => {
      // Always with a title, so enrichment has nothing to fetch, and on a
      // loopback discard port, so even a fetch would never leave the machine.
      await api.post('/api/accio', {
        url: `http://127.0.0.1:9/load/${tag}/${index}`,
        title: `Load link ${index}`,
        tags: [`load-${index % 10}`],
      });
      requests += 1;
    },
  );

  const portkeySlugs = await pool(
    Array.from({ length: plan.portkey }, (_, index) => index),
    16,
    async (index) => {
      const slug = `load-${tag}-${index}`;
      await api.post('/api/portkey', { slug, url: `http://127.0.0.1:9/go/${index}` });
      requests += 1;
      return slug;
    },
  );

  const fileNames = Array.from(
    { length: plan.downloadFiles },
    (_, index) => `load-${tag}-${index}.txt`,
  );
  await pool(fileNames, 4, async (name, index) => {
    await api.upload([{ name, content: prose(64 * 1024 * (1 + (index % 16)), index) }]);
    await api.post(`/api/files/${encodeURIComponent(name)}/publish`);
    requests += 2;
  });
  const folderNames = Array.from(
    { length: plan.downloadFolders },
    (_, index) => `Load folder ${tag} ${index}`,
  );
  for (const [index, folder] of folderNames.entries()) {
    await api.upload(
      Array.from({ length: 8 }, (_, file) => ({
        name: `part-${file}.txt`,
        content: prose(32 * 1024, index * 8 + file),
      })),
      `?folder=${encodeURIComponent(folder)}`,
    );
    requests += 1;
  }
  const listed = await waitForDownloads(api, new Set([...fileNames, ...folderNames]));
  requests += 1;

  return {
    slugs,
    portkeySlugs,
    downloadFileIds: listed.filter((entry) => entry.type === 'file').map((entry) => entry.id),
    downloadFolderIds: listed.filter((entry) => entry.type === 'folder').map((entry) => entry.id),
    requests,
    seconds: (Date.now() - started) / 1000,
  };
}
