import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Api, saveDocument, type DocumentKind, type SavedDocument } from '../support/api.js';
import { browserSpy } from './browser-spy.js';
import { useCliSuite } from './harness.js';

const cli = useCliSuite();

const CONTENT: Record<DocumentKind, string> = {
  runestone: '{"realm":"midgard"}',
  edda: '# Völuspá\n\nThe seeress speaks.\n',
  groot: 'realm: midgard\n',
  atlas: '<realm name="midgard"/>\n',
};
const saved = {} as Record<DocumentKind, SavedDocument>;

beforeAll(async () => {
  const api = new Api(cli.server().baseUrl);
  for (const kind of Object.keys(CONTENT) as DocumentKind[]) {
    saved[kind] = await saveDocument(api, kind, CONTENT[kind], `cli ${kind}`);
  }
});

describe('open', () => {
  it('prints any kind by slug, resolving the kind itself', async () => {
    for (const kind of Object.keys(CONTENT) as DocumentKind[]) {
      const human = await cli.bifrost(['open', saved[kind].slug]);
      expect(human.code, `${kind}: ${human.stderr}`).toBe(0);
      // Human output always ends the document with one newline of its own.
      expect(human.stdout).toBe(`${CONTENT[kind]}\n`);
      const { body } = await cli.json<{ kind: string; content: string }>([
        'open',
        saved[kind].slug,
      ]);
      expect(body).toMatchObject({ kind, content: CONTENT[kind] });
    }
  });

  it('--type skips the lookup, --out writes a file, and an unknown slug exits 4', async () => {
    const typed = await cli.bifrost(['open', saved.groot.slug, '--type', 'groot']);
    expect(typed.stdout).toBe(`${CONTENT.groot}\n`);
    const out = path.join(cli.home().dir, 'out.md');
    expect((await cli.bifrost(['open', saved.edda.slug, '--out', out])).code).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toBe(CONTENT.edda);
    expect((await cli.bifrost(['open', 'no-such-doc-zzzzzz'])).code).toBe(4);
  });
});

describe('preview', () => {
  it('--no-open prints the rendered page for an edda and the raw URL for the others', async () => {
    const edda = await cli.bifrost(['preview', saved.edda.slug, '--no-open']);
    expect(edda.code).toBe(0);
    expect(edda.stdout).toContain(`/edda/preview/${saved.edda.slug}`);
    const rune = await cli.bifrost(['preview', saved.runestone.slug, '--no-open']);
    expect(rune.stdout).toContain(`/runestone/api/${saved.runestone.slug}`);
  });

  it('--json never launches a browser; without it, one is launched', async () => {
    const spy = browserSpy(cli.home().dir, cli.home().env);
    const json = await cli.json<{ url: string }>(['preview', saved.edda.slug], { env: spy.env });
    expect(json.run.code).toBe(0);
    expect(json.body.url).toContain(`/edda/preview/${saved.edda.slug}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(spy.launches()).toEqual([]);

    const launched = await cli.bifrost(['preview', saved.edda.slug], { env: spy.env });
    expect(launched.code).toBe(0);
    expect((await spy.waitForLaunch()).join('\n')).toContain(`/edda/preview/${saved.edda.slug}`);
  });

  it('a local file goes to Saga only when it is markdown or PDF', async () => {
    const deck = path.join(cli.home().dir, 'deck.md');
    fs.writeFileSync(deck, '# One\n\n---\n\n# Two\n');
    const json = await cli.json<{ type: string; url: string }>(['preview', deck, '--type', 'saga']);
    expect(json.run.code).toBe(0);
    expect(json.body.type).toBe('saga');
    expect(json.body.url).toContain('/saga?source=');

    const data = path.join(cli.home().dir, 'data.json');
    fs.writeFileSync(data, '{}');
    const refused = await cli.bifrost(['preview', data, '--type', 'saga']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('--type saga presents markdown and pdf');
  });
});
