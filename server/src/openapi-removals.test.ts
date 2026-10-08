import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * PLAN-35 criterion 12: the committed `server/openapi.json` differs from
 * `develop`'s only by what the plan names — the ten removed operations and
 * `defaultThemeId` on `GET /api/heimdall/access`. Written as "every
 * difference is allowed", so an empty diff (after the merge, when develop has
 * this spec) passes. CI fetches develop so this never skips there; a local
 * clone without it skips. PLAN-37's general "no v1 operation removed" rule
 * replaces this file.
 */

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const SPEC_PATH = 'server/openapi.json';

const REMOVED = new Set([
  'GET /api/themes',
  'POST /api/themes',
  'GET /api/themes/manage',
  'GET /api/themes/{id}',
  'PATCH /api/themes/{id}',
  'DELETE /api/themes/{id}',
  'GET /api/runestone/config',
  'GET /api/edda/config',
  'GET /api/groot/config',
  'GET /api/atlas/config',
]);

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

type Json = Record<string, unknown>;

function developSpec(): Json | null {
  for (const ref of ['origin/develop', 'develop']) {
    try {
      const text = execFileSync('git', ['show', `${ref}:${SPEC_PATH}`], {
        cwd: SERVER_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
      return JSON.parse(text) as Json;
    } catch {
      // Try the next name: a CI checkout has origin/develop, a clone may have develop.
    }
  }
  return null;
}

function operations(spec: Json): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [path, item] of Object.entries(spec.paths as Record<string, Json>)) {
    for (const [method, operation] of Object.entries(item)) {
      if (HTTP_METHODS.has(method)) out.set(`${method.toUpperCase()} ${path}`, operation);
    }
  }
  return out;
}

/**
 * The access read with this plan's one additive field taken back out, and its
 * summary, which was reworded to say what the response now carries.
 */
function withoutDefaultThemeId(operation: unknown): unknown {
  const copy = structuredClone(operation) as {
    summary?: string;
    responses: Record<string, { content: Record<string, { schema: Json }> }>;
  };
  delete copy.summary;
  const schema = copy.responses['200']?.content['application/json']?.schema;
  if (schema) {
    delete (schema.properties as Json | undefined)?.defaultThemeId;
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((key) => key !== 'defaultThemeId');
    }
  }
  return copy;
}

const current = JSON.parse(
  fs.readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
) as Json;
const develop = developSpec();

describe('openapi.json against develop (PLAN-35)', () => {
  it('can read develop’s spec in CI', () => {
    if (process.env.CI) expect(develop, 'CI must fetch develop (see ci.yml)').not.toBeNull();
  });

  it.skipIf(develop === null)('removes only the ten named operations, and adds none', () => {
    const before = operations(develop as Json);
    const after = operations(current);
    const removed = [...before.keys()].filter((key) => !after.has(key));
    const added = [...after.keys()].filter((key) => !before.has(key));
    expect(removed.filter((key) => !REMOVED.has(key))).toEqual([]);
    expect(added).toEqual([]);
  });

  it.skipIf(develop === null)('changes no kept operation but the additive defaultThemeId', () => {
    const before = operations(develop as Json);
    const after = operations(current);
    for (const [key, operation] of after) {
      const old = before.get(key);
      if (old === undefined) continue;
      if (key === 'GET /api/heimdall/access') {
        expect(withoutDefaultThemeId(operation), key).toEqual(withoutDefaultThemeId(old));
      } else {
        expect(operation, key).toEqual(old);
      }
    }
  });

  it.skipIf(develop === null)('keeps everything outside paths as it was', () => {
    const outside = (spec: Json) =>
      Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'paths'));
    expect(outside(current)).toEqual(outside(develop as Json));
  });
});
