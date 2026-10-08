import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { legacyToV1 } from './core/http/versioning.js';

/**
 * A published version only ever grows (PLAN-37). The committed
 * `server/openapi.json` must still carry every operation of `develop`'s spec,
 * with every response status and every response field it had, each field
 * still required where it was required. Additions pass, and an empty diff
 * passes, so this never breaks `develop` after a merge.
 *
 * Operations are matched by `operationId`. The path must match too, with
 * parameter names ignored (`/{slug}` ≡ `/{key}`: a name never reaches the
 * wire). A develop path from before versions existed is compared as the v1
 * path it now means, so this PR's move to v1 is itself checked.
 *
 * CI fetches develop so this never skips there; a local clone without it skips.
 */

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const SPEC_PATH = 'server/openapi.json';
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

type Json = Record<string, unknown>;

interface Operation {
  key: string;
  responses: Record<string, Json>;
}

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

/** `GET /api/v1/runestone/{}`: the method and the path, parameter names dropped. */
function wireKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${(legacyToV1(path) ?? path).replace(/\{[^}]+\}/g, '{}')}`;
}

function operations(spec: Json): Map<string, Operation> {
  const out = new Map<string, Operation>();
  for (const [path, item] of Object.entries(spec.paths as Record<string, Json>)) {
    for (const [method, raw] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      const operation = raw as { operationId?: string; responses?: Record<string, Json> };
      const id = operation.operationId ?? wireKey(method, path);
      out.set(id, { key: wireKey(method, path), responses: operation.responses ?? {} });
    }
  }
  return out;
}

/** What `after` lost of `before`'s fields and required lists, as JSON pointers. */
function lostFields(before: unknown, after: unknown, at: string): string[] {
  if (typeof before !== 'object' || before === null) return [];
  if (typeof after !== 'object' || after === null) return [`${at} (gone)`];
  const was = before as Json;
  const now = after as Json;
  const lost: string[] = [];
  const wasProps = (was.properties ?? {}) as Json;
  const nowProps = (now.properties ?? {}) as Json;
  for (const [name, schema] of Object.entries(wasProps)) {
    if (!(name in nowProps)) lost.push(`${at}/properties/${name}`);
    else lost.push(...lostFields(schema, nowProps[name], `${at}/properties/${name}`));
  }
  const nowRequired = new Set(Array.isArray(now.required) ? now.required : []);
  for (const name of Array.isArray(was.required) ? was.required : []) {
    if (!nowRequired.has(name)) lost.push(`${at}/required/${String(name)}`);
  }
  if ('items' in was) lost.push(...lostFields(was.items, now.items, `${at}/items`));
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    const wasList = was[keyword];
    const nowList = now[keyword];
    if (!Array.isArray(wasList)) continue;
    wasList.forEach((schema: unknown, index) => {
      const next = Array.isArray(nowList) ? (nowList as unknown[])[index] : undefined;
      lost.push(...lostFields(schema, next, `${at}/${keyword}/${index}`));
    });
  }
  return lost;
}

/** Every way `current` breaks a client written against `previous`. */
function breakingChanges(previous: Json, current: Json): string[] {
  const before = operations(previous);
  const after = operations(current);
  const problems: string[] = [];
  for (const [id, old] of before) {
    const now = after.get(id);
    if (now === undefined) {
      problems.push(`${id} (${old.key}): removed`);
      continue;
    }
    if (now.key !== old.key) problems.push(`${id}: moved from ${old.key} to ${now.key}`);
    for (const [status, response] of Object.entries(old.responses)) {
      const kept = now.responses[status];
      if (kept === undefined) {
        problems.push(`${id}: response ${status} removed`);
        continue;
      }
      const content = (response.content ?? {}) as Record<string, Json>;
      const keptContent = (kept.content ?? {}) as Record<string, Json>;
      for (const [type, media] of Object.entries(content)) {
        const at = `${id} ${status} ${type}`;
        if (!(type in keptContent)) problems.push(`${at}: removed`);
        else problems.push(...lostFields(media.schema, keptContent[type]?.schema, at));
      }
    }
  }
  return problems;
}

const current = JSON.parse(
  fs.readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
) as Json;
const develop = developSpec();

describe('openapi.json against develop (PLAN-37: a version only grows)', () => {
  it('can read develop’s spec in CI', () => {
    if (process.env.CI) expect(develop, 'CI must fetch develop (see ci.yml)').not.toBeNull();
  });

  it.skipIf(develop === null)('removes no operation, status or response field', () => {
    expect(breakingChanges(develop as Json, current)).toEqual([]);
  });

  it('passes an identical spec, and an addition', () => {
    expect(breakingChanges(current, current)).toEqual([]);
    const grown = structuredClone(current);
    (grown.paths as Json)['/api/v1/fresh'] = {
      get: { operationId: 'fresh', responses: { 200: { description: 'ok' } } },
    };
    expect(breakingChanges(current, grown)).toEqual([]);
  });

  it('ignores a renamed path parameter, and reads a legacy path as v1', () => {
    const spec = (path: string): Json => ({
      paths: { [path]: { get: { operationId: 'read', responses: {} } } },
    });
    expect(breakingChanges(spec('/api/v1/edda/{slug}'), spec('/api/v1/edda/{key}'))).toEqual([]);
    expect(breakingChanges(spec('/api/edda/{slug}'), spec('/api/v1/edda/{slug}'))).toEqual([]);
    expect(breakingChanges(spec('/api/v1/edda/{slug}'), spec('/api/v2/edda/{slug}'))).toEqual([
      'read: moved from GET /api/v1/edda/{} to GET /api/v2/edda/{}',
    ]);
  });

  it('fails a removed operation, status, field or requirement', () => {
    const access = 'getHeimdallAccess';
    const find = (spec: Json): Json => {
      for (const item of Object.values(spec.paths as Record<string, Json>)) {
        for (const operation of Object.values(item) as Json[]) {
          if (operation.operationId === access) return operation;
        }
      }
      throw new Error(`no ${access} in the spec`);
    };
    const schemaOf = (spec: Json): Json =>
      (
        ((find(spec).responses as Record<string, Json>)['200']?.content as Record<string, Json>)[
          'application/json'
        ] as Json
      ).schema as Json;

    const removed = structuredClone(current);
    for (const item of Object.values(removed.paths as Record<string, Json>)) {
      for (const [method, operation] of Object.entries(item)) {
        if ((operation as Json).operationId === access) delete item[method];
      }
    }
    expect(breakingChanges(current, removed)).toEqual([
      expect.stringMatching(/^getHeimdallAccess .*: removed$/),
    ]);

    const noStatus = structuredClone(current);
    delete (find(noStatus).responses as Json)['200'];
    expect(breakingChanges(current, noStatus)).toEqual([`${access}: response 200 removed`]);

    const field = Object.keys(schemaOf(current).properties as Json)[0] as string;
    const noField = structuredClone(current);
    delete (schemaOf(noField).properties as Json)[field];
    expect(breakingChanges(current, noField)).toContain(
      `${access} 200 application/json/properties/${field}`,
    );

    const optional = structuredClone(current);
    schemaOf(optional).required = [];
    expect(breakingChanges(current, optional)).toContain(
      `${access} 200 application/json/required/${field}`,
    );
  });
});
