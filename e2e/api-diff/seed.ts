import fs from 'node:fs';
import { Api, saveDocument, type DocumentKind } from '../support/api.js';
import { fromRepoRoot } from '../support/paths.js';

/**
 * The data both builds are compared on, written once **through the API** of
 * the base build, then copied to each side. Edge cases on purpose: unicode,
 * maximum-length names, documents saved with no device header (so
 * `authorDeviceId` is null), links with and without titles, empty optional
 * fields, staged files, published files, folders, a custom theme and changed
 * settings — enough rows that every list pages.
 */

export interface Seeded {
  /** A slug that was renamed away from, per kind — the 301 path. */
  staleSlugs: Record<DocumentKind, string[]>;
}

const KINDS: DocumentKind[] = ['runestone', 'edda', 'groot', 'atlas'];

function contentFor(kind: DocumentKind, index: number): string {
  switch (kind) {
    case 'runestone':
      // `big` is past 2^53 on purpose, written as text: the server stores the
      // bytes, and a JSON round trip anywhere would lose the last digit.
      return `{"index":${index},"realm":"${index % 2 ? 'Miðgarðr' : 'Ásgarðr'}","big":9007199254740993,${index % 3 === 0 ? '\n  ' : ''}"nested":{"list":[${index},null,true]}}`;
    case 'edda':
      return index % 5 === 0
        ? `# Völuspá ${index}\n\n\`\`\`mermaid\ngraph LR\n  A --> B\n\`\`\`\n`
        : `# Edda ${index}\n\nᚱᚢᚾᛖ — ${'word '.repeat(index)}\n`;
    case 'groot':
      return `realm: midgard\ncountry: no\nversion: 1.10\nindex: ${index}\n`;
    case 'atlas':
      return index % 4 === 0
        ? `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Index</key><integer>${index}</integer></dict></plist>\n`
        : `<realm index="${index}">Ásgarðr &amp; Miðgarðr</realm>\n`;
  }
}

function nameFor(kind: DocumentKind, index: number): string | undefined {
  if (index === 0) return undefined; // the server generates one
  if (index === 1) return `${'Ý'.repeat(10)}${'n'.repeat(70)}`; // exactly 80 characters
  if (index === 2) return 'Völuspá — the seeress ᚱᚢᚾᛖ 🌉';
  return `${kind} ${String(index).padStart(2, '0')}`;
}

export async function seed(baseUrl: string, admin: Api): Promise<Seeded> {
  const deviceA = new Api(baseUrl, 'diff-device-a');
  const deviceB = new Api(baseUrl, 'diff-device-b');
  const anonymous = new Api(baseUrl, null);
  const staleSlugs = { runestone: [], edda: [], groot: [], atlas: [] } as Record<
    DocumentKind,
    string[]
  >;

  for (const kind of KINDS) {
    for (let index = 0; index < 34; index += 1) {
      const author = index % 7 === 0 ? anonymous : index % 2 ? deviceA : deviceB;
      const doc = await saveDocument(author, kind, contentFor(kind, index), nameFor(kind, index));
      if (index % 11 === 3) {
        await deviceA.put(`/api/${kind}/${doc.id}`, { name: `${kind} renamed ${index}` });
        staleSlugs[kind].push(doc.slug);
      }
      if (index % 13 === 5)
        await deviceA.put(`/api/${kind}/${doc.id}`, { content: contentFor(kind, index + 100) });
    }
  }

  for (let index = 0; index < 38; index += 1) {
    const body: Record<string, unknown> = {
      url: `https://example.invalid/shelf/${index}?q=ä&n=${index}`,
    };
    if (index % 3 !== 0)
      body.title =
        index % 5 === 0 ? `Ünïcödé title ${index} 🌉` : `Link ${String(index).padStart(2, '0')}`;
    if (index % 2 === 0) body.tags = index % 4 === 0 ? ['lore', 'norse'] : ['tools'];
    await (index % 2 ? deviceA : anonymous).post('/api/accio', body);
  }
  // A link with no title on a host that refuses: enrichment tries, fails, and
  // the title stays null — on the base build, before anything is copied.
  await deviceA.post('/api/accio', { url: 'http://127.0.0.1:9/never' });

  for (let index = 0; index < 36; index += 1) {
    const body: Record<string, unknown> = {
      slug: `link-${String(index).padStart(2, '0')}`,
      url: `http://10.0.0.${index + 1}:8080/path`,
    };
    if (index % 2 === 0) body.note = index % 4 === 0 ? 'the box under the stairs — ᚱ' : '';
    await (index % 3 ? deviceA : deviceB).post('/api/portkey', body);
  }
  for (const slug of ['link-01', 'link-01', 'link-02'])
    await deviceA.get(`/go/${slug}`, { expect: [302] });

  await deviceA.post('/api/clipboard', { text: 'ssh pi@10.0.0.7', ttlSeconds: 604800 });
  await deviceB.post('/api/clipboard', { text: 'const answer = 42;', kind: 'code', lang: 'ts' });
  await anonymous.post('/api/clipboard', { text: 'Ünïcödé 🌉 https://bifrost.local/go/router' });

  // One file per request, a beat apart: the downloads listing sorts by mtime,
  // and two files written in the same millisecond would tie, leaving their
  // order to the watcher's scan.
  const uploads: [Api, string, string, string][] = [
    [deviceA, 'staged notes.txt', 'staged on the host\n', ''],
    [deviceA, 'Völuspá.md', '# Völuspá\n', ''],
    [deviceA, 'data.json', '{"a":1}', ''],
    [deviceB, 'published.txt', 'for everyone\n', ''],
    [deviceB, 'photo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', ''],
    [deviceA, 'day-one.txt', 'sun', '?folder=Holiday'],
    [deviceA, 'day-two.txt', 'rain', '?folder=Holiday'],
    [deviceA, 'ᚱᚢᚾᛖ.txt', 'runes', `?folder=${encodeURIComponent('Ünïcödé folder')}`],
  ];
  for (const [api, name, content, query] of uploads) {
    await api.upload([{ name, content }], query);
    if (name === 'published.txt' || name === 'photo.svg')
      await api.post(`/api/files/${encodeURIComponent(name)}/publish`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  for (const [index, device] of ['diff-device-a', 'diff-device-b'].entries()) {
    await new Api(baseUrl, device).post('/api/nimbus/results', {
      downMbps: 100.5 + index,
      upMbps: 80.25,
      latencyMs: 1.5,
      testMb: 10,
    });
  }

  const aurora = JSON.parse(
    fs.readFileSync(fromRepoRoot('themes', 'aurora.json'), 'utf8'),
  ) as Record<string, unknown>;
  await admin.post('/api/themes', { ...aurora, id: 'diff-frost', name: 'Diff Frost' });
  await admin.patch('/api/themes/tokyo', { enabled: false });
  await admin.patch('/api/heimdall/settings', { tapCount: 5, defaultThemeId: 'daybreak' });
  await admin.patch('/api/loki/settings', { fetchAllowed: false });
  await admin.patch('/api/screensaver/settings', { idleSeconds: 120 });
  await admin.patch('/api/offline-mode/settings', { id: 'loki', enabled: false });

  return { staleSlugs };
}

/** Wait for anything the seed set in motion in the background (Accio title enrichment, the downloads watcher). */
export async function settle(baseUrl: string): Promise<void> {
  const api = new Api(baseUrl);
  const deadline = Date.now() + 15_000;
  for (;;) {
    const downloads = (await api.get('/api/downloads')).json<{ name: string }[]>();
    const names = new Set(downloads.map((entry) => entry.name));
    if (
      ['published.txt', 'photo.svg', 'Holiday', 'day-one.txt', 'day-two.txt', 'ᚱᚢᚾᛖ.txt'].every(
        (name) => names.has(name),
      )
    )
      break;
    if (Date.now() > deadline)
      throw new Error('the downloads watcher never listed the seeded files');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  // Enrichment of the one refused link: two attempts against a closed port.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}
