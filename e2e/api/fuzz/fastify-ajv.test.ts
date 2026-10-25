import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Operation } from '../support/spec.js';
import { FastifyOracle } from './fastify-ajv.js';

/**
 * The oracle and a bare Fastify instance must agree on every case the
 * PLAN-33 spike found (fastify 5 defaults): if a Fastify upgrade changes how
 * it coerces or strips, this fails before the fuzzer starts lying.
 */

const bodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: { name: { type: 'string' }, count: { type: 'integer' } },
} as const;

const operation: Operation = {
  method: 'POST',
  template: '/things/{id}',
  operationId: 'makeThing',
  tags: [],
  admin: false,
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 2 } },
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', maximum: 5 } },
  ],
  body: { schema: bodySchema, required: true },
  responses: {},
};

async function fastifySays(id: string, query: string, body: unknown): Promise<boolean> {
  const app = Fastify();
  app.post(
    '/things/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', minLength: 2 } },
        },
        querystring: { type: 'object', properties: { limit: { type: 'integer', maximum: 5 } } },
        body: bodySchema,
      },
    },
    () => ({ ok: true }),
  );
  const response = await app.inject({
    method: 'POST',
    url: `/things/${id}${query}`,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
  await app.close();
  if (response.statusCode !== 200 && response.statusCode !== 400) {
    throw new Error(`unexpected ${response.statusCode}`);
  }
  return response.statusCode === 200;
}

const CASES: [
  label: string,
  id: string,
  query: Record<string, string>,
  body: unknown,
  accepted: boolean,
][] = [
  ['a valid request', 'ab', {}, { name: 'x' }, true],
  ['an unknown property is stripped, not refused', 'ab', {}, { name: 'x', extra: 1 }, true],
  ['123 for a string is coerced', 'ab', {}, { name: 123 }, true],
  ['true for a string is coerced', 'ab', {}, { name: true }, true],
  ['null for a string is coerced to ""', 'ab', {}, { name: null }, true],
  ['["a"] for a string is unwrapped', 'ab', {}, { name: ['a'] }, true],
  ['"7" for an integer is coerced', 'ab', {}, { name: 'x', count: '7' }, true],
  ['"x" for an integer is refused', 'ab', {}, { name: 'x', count: 'x' }, false],
  ['a missing required field is refused', 'ab', {}, { count: 1 }, false],
  ['an object for a string is refused', 'ab', {}, { name: { a: 1 } }, false],
  ['a path param under minLength is refused', 'a', {}, { name: 'x' }, false],
  ['a query integer over maximum is refused', 'ab', { limit: '6' }, { name: 'x' }, false],
  ['an uncoercible query integer is refused', 'ab', { limit: 'many' }, { name: 'x' }, false],
];

describe('the Fastify ajv oracle', () => {
  const oracle = new FastifyOracle();
  it.each(CASES)('%s', async (_label, id, query, body, accepted) => {
    const search = new URLSearchParams(query).toString();
    expect(await fastifySays(id, search ? `?${search}` : '', body)).toBe(accepted);
    expect(oracle.judge(operation, { params: { id }, query, body }).accepted).toBe(accepted);
  });
});
