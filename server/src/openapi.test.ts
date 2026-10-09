import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createConfig, lintFromString } from '@redocly/openapi-core';
import { Validator } from '@seriousme/openapi-schema-validator';
import { OPENAPI_FILE, formatOpenApiSpec, generateOpenApiSpec } from './openapi-spec.js';

/**
 * `server/openapi.json` is generated, committed, and must stay current
 * (PLAN-32, criterion 9). The version is ignored: a release bump changes
 * `info.version` without touching a single route.
 */

type Spec = Record<string, unknown> & { info?: Record<string, unknown> };

/**
 * The strict lint (PLAN-38): Redocly's `recommended` ruleset. Every rule holds
 * except these, each for its reason and each limited to the operations named,
 * so a new operation that breaks one fails here instead of joining silently.
 */
const UNMET: Record<string, { reason: string; at: string[] }> = {
  'operation-4xx-response': {
    reason:
      'These take no path, query or body input and need no session, so no request to them ' +
      'can be refused: a 4xx entry would describe an answer they never give.',
    at: [
      'GET /api/v1/events',
      'GET /api/v1/health',
      'GET /api/v1/files/config',
      'GET /api/v1/downloads',
      'GET /api/v1/qr/server-url',
      'GET /api/v1/heimdall/access',
      'GET /api/v1/clipboard',
      'GET /api/v1/presence',
      'GET /api/v1/loki/config',
      'GET /api/v1/brotli/config',
      'GET /api/v1/nimbus/config',
      'GET /api/v1/nimbus/ping',
      'GET /api/v1/screensaver/config',
      'GET /api/v1/client-logs/config',
      'GET /metrics',
      'GET /api/v1/offline-mode/config',
      'GET /api/v1/capabilities',
    ],
  },
  'operation-2xx-response': {
    reason: 'A go-link is a redirect and nothing else: 302 is its success.',
    at: ['GET /go/{slug}'],
  },
};

/** `GET /api/v1/health` for a problem at `#/paths/~1api~1v1~1health/get/responses`. */
function operationAt(pointer: string): string {
  const [, path = '', method = ''] = /^#\/paths\/([^/]+)\/([a-z]+)/.exec(pointer) ?? [];
  return `${method.toUpperCase()} ${path.replaceAll('~1', '/').replaceAll('~0', '~')}`;
}

function withoutVersion(spec: Spec): Spec {
  return { ...spec, info: { ...spec.info, version: '(ignored)' } };
}

describe('server/openapi.json', () => {
  it('is current — run `npm run api:spec` after changing a route', async () => {
    const generated = withoutVersion(await generateOpenApiSpec());
    const committed = withoutVersion(JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8')) as Spec);
    expect(formatOpenApiSpec(committed)).toBe(formatOpenApiSpec(generated));
  });

  it('ignores info.version, so a release bump alone is not stale', () => {
    const spec: Spec = { openapi: '3.1.0', info: { title: 'Bifrost', version: '1.0.0' } };
    expect(withoutVersion({ ...spec, info: { ...spec.info, version: '9.9.9' } })).toEqual(
      withoutVersion(spec),
    );
  });

  it('is a valid OpenAPI 3.1 description', async () => {
    const validator = new Validator();
    const result = await validator.validate(
      JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8')) as Record<string, unknown>,
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(validator.version).toBe('3.1');
  });

  it('passes the strict lint, apart from the reasoned exceptions', async () => {
    const config = await createConfig({ extends: ['recommended'] });
    const problems = await lintFromString({
      source: fs.readFileSync(OPENAPI_FILE, 'utf8'),
      absoluteRef: OPENAPI_FILE,
      config,
    });
    const unexpected = problems
      .map((problem) => ({
        rule: problem.ruleId,
        at: operationAt(problem.location[0]?.pointer ?? ''),
        message: problem.message,
      }))
      .filter((problem) => !UNMET[problem.rule]?.at.includes(problem.at));
    expect(unexpected).toEqual([]);
    // And every exception is still needed.
    for (const [rule, { at }] of Object.entries(UNMET)) {
      const hits = problems.filter((problem) => problem.ruleId === rule);
      expect(
        hits.map((problem) => operationAt(problem.location[0]?.pointer ?? '')).sort(),
        rule,
      ).toEqual([...at].sort());
    }
  }, 30_000);

  it('describes each document kind once per key, at /{key}', () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8')) as {
      paths: Record<
        string,
        Record<string, { parameters?: { name: string; schema: { maxLength: number } }[] }>
      >;
    };
    for (const kind of ['runestone', 'edda', 'groot', 'atlas']) {
      const item = spec.paths[`/api/v1/${kind}/{key}`];
      expect(Object.keys(item ?? {}).sort(), kind).toEqual(['delete', 'get', 'put']);
      expect(spec.paths[`/api/v1/${kind}/{slug}`], kind).toBeUndefined();
      expect(spec.paths[`/api/v1/${kind}/{id}`], kind).toBeUndefined();
      // Each operation keeps its own constraint: a slug, or an id.
      expect(item?.get?.parameters?.[0]?.schema.maxLength).toBe(80);
      expect(item?.put?.parameters?.[0]?.schema.maxLength).toBe(16);
    }
  });
});
