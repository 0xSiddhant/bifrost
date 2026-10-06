import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { RunningApp } from './app.js';
import type { RouteCatalogEntry } from './core/http/openapi.js';
import { createTestApp } from './testing/app.js';

/**
 * Every route is described (PLAN-32, criterion 6): `tags`, a `summary`, a
 * unique `operationId`, a success entry, a `400` entry wherever a request
 * schema can refuse input, and `security` exactly when `requireAdmin` guards
 * it. Auto-`HEAD` routes and hidden ones (`@fastify/static`) are skipped.
 * A new route fails here until it is described.
 */

type Schema = Record<string, unknown>;

const keyOf = (route: Pick<RouteCatalogEntry, 'method' | 'url'>): string =>
  `${route.method} ${route.url}`;

/** Why a route is not yet described, or an empty list. */
function problemsOf(route: RouteCatalogEntry): string[] {
  const schema = (route.schema ?? {}) as Schema;
  const problems: string[] = [];
  if (!Array.isArray(schema.tags) || schema.tags.length === 0) problems.push('no tags');
  if (typeof schema.summary !== 'string' || schema.summary.trim() === '')
    problems.push('no summary');
  if (typeof schema.operationId !== 'string' || schema.operationId === '') {
    problems.push('no operationId');
  }
  const responses = (schema.response ?? {}) as Schema;
  const statuses = Object.keys(responses);
  if (!statuses.some((status) => /^[23]/.test(status))) problems.push('no 2xx/3xx response');
  const validates = ['body', 'querystring', 'params', 'headers'].some((part) => part in schema);
  if (validates && !('400' in responses)) problems.push('a request schema but no 400 response');
  const secured = Array.isArray(schema.security) && schema.security.length > 0;
  if (route.admin && !secured) problems.push('guarded by requireAdmin but declares no security');
  if (!route.admin && secured) problems.push('declares security but is not guarded');
  return problems;
}

describe('API coverage', () => {
  let app: RunningApp;
  let routes: RouteCatalogEntry[];

  beforeAll(async () => {
    app = await createTestApp();
    await app.fastify.ready();
    routes = app.fastify.routeCatalog().filter((route) => route.method !== 'HEAD' && !route.hide);
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(app.config.storage.root, { recursive: true, force: true });
  });

  it('describes every route', () => {
    const failing = routes
      .map((route) => ({ route: keyOf(route), problems: problemsOf(route) }))
      .filter((entry) => entry.problems.length > 0);
    expect(failing).toEqual([]);
  });

  it('gives every operation a unique operationId', () => {
    const ids = routes
      .map((route) => (route.schema as Schema | undefined)?.operationId)
      .filter((id): id is string => typeof id === 'string');
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it('serves no API docs route (a later plan, on its own port)', () => {
    expect(routes.filter((route) => /documentation|swagger|openapi/i.test(route.url))).toEqual([]);
  });
});
