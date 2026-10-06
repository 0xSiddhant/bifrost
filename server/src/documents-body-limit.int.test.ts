import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { RunningApp } from './app.js';
import { createTestApp } from './testing/app.js';

/**
 * The four document kinds at their **real default** caps (PLAN-33): 2048 KB
 * each, measured on the decoded text. Every older test set `maxDocKb: 1`,
 * which hid that Fastify's 1 MiB default body limit refused any document over
 * ~1 MB with its own `FST_ERR_CTP_BODY_TOO_LARGE`.
 */

const KINDS = ['runestone', 'edda', 'groot', 'atlas'] as const;
const CAP_BYTES = 2048 * 1024;

/** A document of exactly `bytes` UTF-8 bytes that each kind accepts as content. */
function documentOf(kind: (typeof KINDS)[number], bytes: number): string {
  // Runestone parses JSON; the others only store text.
  return kind === 'runestone' ? `"${'a'.repeat(bytes - 2)}"` : 'a'.repeat(bytes);
}

describe('document size caps at their defaults', () => {
  let app: RunningApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(app.config.storage.root, { recursive: true, force: true });
  });

  const post = (kind: string, content: string) =>
    app.fastify.inject({ method: 'POST', url: `/api/${kind}`, payload: { content } });

  for (const kind of KINDS) {
    it(`${kind}: a 1.5 MB document saves, and one byte over the cap is PAYLOAD_TOO_LARGE`, async () => {
      expect((await post(kind, documentOf(kind, 1_500_000))).statusCode).toBe(201);
      expect((await post(kind, documentOf(kind, CAP_BYTES))).statusCode).toBe(201);
      const over = await post(kind, documentOf(kind, CAP_BYTES + 1));
      expect(over.statusCode).toBe(413);
      expect(over.json()).toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
    });

    it(`${kind}: an update is held to the same cap`, async () => {
      const created = (await post(kind, documentOf(kind, 10))).json<{ id: string }>();
      const update = (content: string) =>
        app.fastify.inject({
          method: 'PUT',
          url: `/api/${kind}/${created.id}`,
          payload: { content },
        });
      expect((await update(documentOf(kind, CAP_BYTES))).statusCode).toBe(200);
      const over = await update(documentOf(kind, CAP_BYTES + 1));
      expect(over.statusCode).toBe(413);
      expect(over.json()).toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
    });
  }

  it('a document that is all control characters (6 bytes each once JSON-escaped) still saves at the cap', async () => {
    // The worst case the body limit is sized for: the cap is on the decoded
    // text, the body limit on the JSON that carries it.
    const response = await post('edda', '\u0001'.repeat(CAP_BYTES));
    expect(response.statusCode).toBe(201);
  });

  it('a body over the route limit is refused before the usecase, with the same code', async () => {
    const huge = 'x'.repeat(CAP_BYTES * 6 + 64 * 1024);
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/edda',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ content: huge }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
  });
});
