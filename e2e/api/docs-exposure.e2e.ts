import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromRepoRoot } from '../support/paths.js';
import { startServer, type E2EServer } from '../support/server.js';

/**
 * PLAN-38 criterion 2: the API docs live on the API server's loopback port.
 * Through the web host on PORT, the address every device opens, `/docs` and
 * its spec are never served: the web host forwards only the API prefixes, so
 * these fall to the client's own page (its not-found route). And neither
 * client build names the docs anywhere.
 */

const DOCS_PATHS = ['/docs', '/docs/', '/docs/json', '/docs/yaml', '/docs/static/index.html'];

let server: E2EServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server?.stop();
});

async function get(url: string): Promise<{ status: number; type: string; body: string }> {
  const response = await fetch(url, { redirect: 'manual' });
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    body: await response.text(),
  };
}

describe('the API docs stay off the client port (PLAN-38)', () => {
  it('are served on the API port', async () => {
    const page = await get(`${server.apiUrl}/docs`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('swagger-ui');
    expect((await get(`${server.apiUrl}/docs/json`)).body).toContain('"openapi"');
  });

  it('are never served through the web host: each path is the client shell, or a 404', async () => {
    expect(server.hasWebHost).toBe(true);
    for (const docsPath of DOCS_PATHS) {
      const answer = await get(`${server.baseUrl}${docsPath}`);
      expect(answer.body, docsPath).not.toContain('swagger-ui');
      expect(answer.body, docsPath).not.toContain('"openapi"');
      expect(answer.body, docsPath).not.toContain('openapi:');
      expect(answer.status === 404 || answer.type.startsWith('text/html'), docsPath).toBe(true);
    }
  });

  it('are named by neither client build', () => {
    const files = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return files(full);
        return /\.(js|html)$/.test(entry.name) ? [full] : [];
      });
    for (const build of ['dist', 'dist-standalone']) {
      const dir = fromRepoRoot('client', build);
      expect(fs.existsSync(dir), `${build}: run npm run build`).toBe(true);
      const hits = files(dir).filter((file) =>
        /\/docs\/json|swagger-ui|swagger-initializer/.test(fs.readFileSync(file, 'utf8')),
      );
      expect(hits, build).toEqual([]);
    }
  });
});
