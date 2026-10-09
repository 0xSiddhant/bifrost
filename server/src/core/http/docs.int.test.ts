import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningApp } from '../../app.js';
import { createTestApp } from '../../testing/app.js';
import { OPENAPI_FILE } from '../../openapi-spec.js';
import { DOCS_CSP } from './docs.js';

/**
 * PLAN-38 criteria 1 and 3: the API server serves Swagger UI at /docs over the
 * live spec, which is the committed one, under a CSP that allows nothing
 * outside the page's own origin.
 */

type Spec = Record<string, unknown> & { info: Record<string, unknown> };

const withoutVersion = (spec: Spec): Spec => ({ ...spec, info: { ...spec.info, version: '-' } });

describe('the API docs (PLAN-38)', () => {
  let app: RunningApp;

  beforeAll(async () => {
    app = await createTestApp();
    await app.fastify.ready();
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(app.config.storage.root, { recursive: true, force: true });
  });

  const get = (url: string) => app.fastify.inject({ method: 'GET', url });

  it('serves Swagger UI at /docs', async () => {
    const page = await get('/docs');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.body).toContain('swagger-ui');
  });

  it('serves the live spec at /docs/json: the committed one, apart from info.version', async () => {
    const live = (await get('/docs/json')).json<Spec>();
    const committed = JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8')) as Spec;
    expect(withoutVersion(live)).toEqual(withoutVersion(committed));
    expect((await get('/docs/yaml')).statusCode).toBe(200);
  });

  it('sends its own same-origin CSP on the page and its assets', async () => {
    for (const url of ['/docs', '/docs/json', '/docs/static/swagger-initializer.js']) {
      const response = await get(url);
      expect(response.headers['content-security-policy'], url).toBe(DOCS_CSP);
    }
    expect(DOCS_CSP).not.toMatch(/https?:|validator\.swagger\.io|upgrade-insecure-requests/);
  });

  it('turns off the validator badge and loads nothing from another host', async () => {
    const initializer = (await get('/docs/static/swagger-initializer.js')).body;
    expect(initializer).toContain('"validatorUrl":null');
    const page = (await get('/docs')).body;
    expect(page.match(/(?:src|href)="https?:\/\/[^"]+"/g) ?? []).toEqual([]);
  });

  it('keeps the docs out of the legacy rewrite and the legacy metric', async () => {
    const page = await get('/docs');
    expect(page.headers.deprecation).toBeUndefined();
    expect((await get('/api/docs')).statusCode).toBe(404);
  });
});
