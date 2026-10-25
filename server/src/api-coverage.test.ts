import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { RunningApp } from './app.js';
import type { RouteCatalogEntry } from './core/http/openapi.js';
import { isReservedRoot } from './core/reserved-roots.js';
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

/**
 * Every route is versioned from its first commit (PLAN-37): `/api/v<n>/…`, or a
 * raw document at `/<kind>/api/v<n>/:slug`. Only these are not, each for a
 * reason. Hidden routes count too: they are routes, just not in the spec.
 */
const UNVERSIONED_ALLOWED: Record<string, string> = {
  'GET /go/:slug': 'a human URL printed on QR codes and typed by hand, not an API',
  'GET /metrics': 'Prometheus scrapes /metrics at the root by convention, not an API',
};

/** Unversioned prefixes, each for a reason (PLAN-38). */
const UNVERSIONED_PREFIXES: Record<string, string> = {
  '/docs': 'Swagger UI and the spec it reads (PLAN-38): a page about the API, not an API',
};

const VERSIONED = /^(?:\/api|\/(?:runestone|edda|groot|atlas)\/api)\/v\d+\//;

/** The routes outside a versioned prefix and outside the allowlist. */
function unversioned(routes: readonly Pick<RouteCatalogEntry, 'method' | 'url'>[]): string[] {
  return routes
    .map(keyOf)
    .filter((key) => !(key in UNVERSIONED_ALLOWED))
    .filter((key) => {
      const url = key.slice(key.indexOf(' ') + 1);
      const prefixed = Object.keys(UNVERSIONED_PREFIXES).some(
        (prefix) => url === prefix || url.startsWith(`${prefix}/`),
      );
      return !prefixed && !VERSIONED.test(url);
    });
}

describe('API coverage', () => {
  let app: RunningApp;
  let routes: RouteCatalogEntry[];
  /** Hidden ones too: the versioning and reserved-root rules hold for every route. */
  let allRoutes: RouteCatalogEntry[];

  beforeAll(async () => {
    app = await createTestApp();
    await app.fastify.ready();
    allRoutes = app.fastify.routeCatalog().filter((route) => route.method !== 'HEAD');
    routes = allRoutes.filter((route) => !route.hide);
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

  it('versions every route but the reasoned allowlist', () => {
    expect(unversioned(allRoutes)).toEqual([]);
  });

  it('would refuse a route registered outside a version', () => {
    expect(
      unversioned([
        { method: 'GET', url: '/api/fresh' },
        { method: 'GET', url: '/runestone/api/:slug' },
        { method: 'GET', url: '/api/v2/fresh' },
        { method: 'GET', url: '/go/:slug' },
        { method: 'GET', url: '/docs/json' },
        { method: 'GET', url: '/docsearch' },
      ]),
    ).toEqual(['GET /api/fresh', 'GET /runestone/api/:slug', 'GET /docsearch']);
  });

  it('reserves every first path segment a route uses (Portkey slugs cannot shadow one)', () => {
    const roots = new Set(allRoutes.map((route) => route.url.split('/')[1] ?? ''));
    expect([...roots].filter((root) => !isReservedRoot(root))).toEqual([]);
  });

  it('gives every operation a unique operationId', () => {
    const ids = routes
      .map((route) => (route.schema as Schema | undefined)?.operationId)
      .filter((id): id is string => typeof id === 'string');
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it('serves the API docs only under /docs, all hidden from the spec (PLAN-38)', () => {
    const docs = allRoutes.filter((route) => /documentation|swagger|openapi|docs/i.test(route.url));
    expect(docs.map((route) => route.url)).toContain('/docs');
    expect(docs.filter((route) => !route.url.startsWith('/docs') || !route.hide)).toEqual([]);
  });
});
