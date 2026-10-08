import { describe, expect, it } from 'vitest';
import { Spec, loadSpec } from './spec.js';

describe('Spec', () => {
  const spec = new Spec({
    paths: {
      '/api/things/{id}': { get: { operationId: 'getTheme', responses: { 200: {} } } },
      '/api/things/manage': {
        get: {
          operationId: 'listManaged',
          security: [{ adminSession: [] }],
          responses: { 200: {} },
        },
      },
      '/go/{slug}': { get: { operationId: 'go', responses: { 302: {}, 400: {} } } },
      '/api/x': {
        get: {
          operationId: 'getX',
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['n'],
                    properties: { n: { type: ['integer', 'null'] } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  it('prefers a literal segment over a parameter, and resolves HEAD to GET', () => {
    expect(spec.find('GET', '/api/things/manage')?.operationId).toBe('listManaged');
    expect(spec.find('HEAD', '/api/things/aurora')?.operationId).toBe('getTheme');
    expect(spec.find('GET', '/api/things/a/b')).toBeUndefined();
    expect(spec.byId('listManaged').admin).toBe(true);
  });

  it('checks the status is declared and a JSON body validates (OpenAPI 3.1 nullable arrays)', () => {
    const op = spec.byId('getX');
    expect(spec.check(op, 'GET', 200, 'application/json; charset=utf-8', '{"n":null}')).toBeNull();
    expect(spec.check(op, 'GET', 200, 'application/json', '{"n":"x"}')).toContain('/n');
    expect(spec.check(op, 'GET', 500, 'application/json', '{}')).toContain('500 is not declared');
    expect(spec.check(op, 'GET', 200, 'text/html', '<p>')).toContain('declared application/json');
    expect(spec.check(op, 'HEAD', 200, '', '')).toBeNull();
  });

  it('counts a redirect as success only for an operation that declares no 2xx', () => {
    expect(spec.isSuccess(spec.byId('go'), 302)).toBe(true);
    expect(spec.isSuccess(spec.byId('getX'), 302)).toBe(false);
  });

  it('loads the committed openapi.json: 85 operations, each with a unique id', () => {
    const real = loadSpec();
    expect(real.operations).toHaveLength(85);
    expect(new Set(real.operations.map((op) => op.operationId)).size).toBe(85);
  });
});
