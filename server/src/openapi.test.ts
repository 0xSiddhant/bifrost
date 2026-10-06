import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Validator } from '@seriousme/openapi-schema-validator';
import { OPENAPI_FILE, formatOpenApiSpec, generateOpenApiSpec } from './openapi-spec.js';

/**
 * `server/openapi.json` is generated, committed, and must stay current
 * (PLAN-32, criterion 9). The version is ignored: a release bump changes
 * `info.version` without touching a single route.
 */

type Spec = Record<string, unknown> & { info?: Record<string, unknown> };

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
});
