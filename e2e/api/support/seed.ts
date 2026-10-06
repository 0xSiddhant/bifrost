import type { Client } from './http.js';
import type { Operation } from './spec.js';

/**
 * One of everything, created through the public API only (PLAN-33): if
 * something cannot be seeded over HTTP, no client can create it either.
 */

export const DOCUMENT_KINDS = ['runestone', 'edda', 'groot', 'atlas'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_CONTENT: Record<DocumentKind, string> = {
  runestone: '{"realm":"midgard","bridges":[1,2,3]}',
  edda: '# Völuspá\n\nThe seeress speaks of **Yggdrasil**.\n',
  groot: 'realm: midgard\nbridges:\n  - bifrost\n',
  atlas: '<?xml version="1.0" encoding="UTF-8"?>\n<realms><realm name="midgard"/></realms>\n',
};

export interface Seeds {
  documents: Record<DocumentKind, { id: string; slug: string }>;
  /** A staged upload (uploads/). */
  upload: string;
  /** A file in downloads/ and a folder of two files. */
  downloadFile: string;
  downloadFolder: string;
  clipboard: string;
  accio: string;
  portkey: string;
  theme: string;
}

interface DownloadEntry {
  id: string;
  name: string;
  type: 'file' | 'folder';
  parent: string | null;
}

/** Poll the listing until the watcher has indexed what was just placed. */
export async function waitForDownload(
  client: Client,
  match: (entry: DownloadEntry) => boolean,
  timeoutMs = 15_000,
): Promise<DownloadEntry> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await client.get('/api/downloads')).json<DownloadEntry[]>().find(match);
    if (found) return found;
    if (Date.now() > deadline) throw new Error('the download never appeared in the listing');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function ok<T>(response: { status: number; text: string; json<U>(): U }, what: string): T {
  if (response.status >= 300)
    throw new Error(`seeding ${what} → ${response.status}: ${response.text}`);
  return response.json<T>();
}

export async function seedAll(client: Client, sinkBaseUrl: string): Promise<Seeds> {
  const tag = Date.now().toString(36);
  const documents = {} as Seeds['documents'];
  for (const kind of DOCUMENT_KINDS) {
    documents[kind] = ok(
      await client.post(`/api/${kind}`, {
        name: `Seed ${kind} ${tag}`,
        content: DOCUMENT_CONTENT[kind],
      }),
      kind,
    );
  }

  const upload = `seed-${tag}.txt`;
  ok(await client.upload([{ name: upload, content: 'a staged upload\n' }]), 'upload');

  const published = `seed-published-${tag}.txt`;
  ok(
    await client.upload([{ name: published, content: '0123456789abcdefghij\n' }]),
    'publish source',
  );
  ok(await client.post(`/api/files/${encodeURIComponent(published)}/publish`), 'publish');
  const folderName = `Seed folder ${tag}`;
  ok(
    await client.upload(
      [
        { name: 'one.txt', content: 'one\n' },
        { name: 'two.txt', content: 'two\n' },
      ],
      `?folder=${encodeURIComponent(folderName)}`,
    ),
    'folder upload',
  );
  const file = await waitForDownload(client, (entry) => entry.name === published);
  const folder = await waitForDownload(
    client,
    (entry) => entry.type === 'folder' && entry.name === folderName,
  );
  await waitForDownload(client, (entry) => entry.parent === folderName && entry.name === 'two.txt');

  const clipboard = ok<{ id: string }>(
    await client.post('/api/clipboard', { text: `seed clip ${tag}` }),
    'clipboard',
  ).id;
  const accio = ok<{ id: string }>(
    await client.post('/api/accio', { url: `${sinkBaseUrl}/page/seed-${tag}`, tags: ['seed'] }),
    'accio',
  ).id;
  const portkey = `seed-${tag}`;
  ok(
    await client.post('/api/portkey', { slug: portkey, url: 'http://127.0.0.1:9/router' }),
    'portkey',
  );

  return {
    documents,
    upload,
    downloadFile: file.id,
    downloadFolder: folder.id,
    clipboard,
    accio,
    portkey,
    theme: 'aurora',
  };
}

/** A concrete URL for a GET operation, its path parameters filled from the seeds. */
export function readPath(op: Operation, seeds: Seeds): string {
  const kind = DOCUMENT_KINDS.find(
    (candidate) =>
      op.template.startsWith(`/api/${candidate}/`) || op.template.startsWith(`/${candidate}/api/`),
  );
  const value = (name: string): string => {
    if (kind) return name === 'slug' ? seeds.documents[kind].slug : seeds.documents[kind].id;
    if (op.template.startsWith('/api/downloads/')) {
      return op.template.endsWith('/archive') ? seeds.downloadFolder : seeds.downloadFile;
    }
    if (op.template.startsWith('/api/files/')) return seeds.upload;
    if (op.template.startsWith('/api/themes/')) return seeds.theme;
    if (op.template.startsWith('/api/clipboard/')) return seeds.clipboard;
    if (op.template.startsWith('/api/accio/')) return seeds.accio;
    if (op.template.startsWith('/api/portkey/') || op.template.startsWith('/go/'))
      return seeds.portkey;
    throw new Error(`no seed for {${name}} in ${op.template}`);
  };
  return op.template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    encodeURIComponent(value(name)),
  );
}
