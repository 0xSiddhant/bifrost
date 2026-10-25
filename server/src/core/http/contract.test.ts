import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import type { ContractCheckMode } from '../config/index.js';
import { firstDifference, registerContractCheck, strictify } from './contract.js';

/**
 * The guard's own contract (PLAN-32, criteria 7 and 8). Each case is one of
 * the ways the spike showed a response schema silently rewriting bytes, and
 * strict mode must turn every one into a loud 500, while fallback must send
 * the original bytes and say where they diverged.
 */

interface Built {
  app: FastifyInstance;
  lines: Array<Record<string, unknown>>;
}

async function build(mode: ContractCheckMode, register: (app: FastifyInstance) => void): Promise<Built> {
  const lines: Array<Record<string, unknown>> = [];
  const log = pino({ level: 'trace' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  const app = Fastify();
  registerContractCheck(app as unknown as FastifyInstance, mode, log);
  register(app as unknown as FastifyInstance);
  await app.ready();
  return { app: app as unknown as FastifyInstance, lines };
}

const obj = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties,
  ...extra,
});

/** One route answering `payload` under `schema` for status 200. */
async function route(mode: ContractCheckMode, schema: unknown, payload: unknown, status = 200) {
  return build(mode, (app) => {
    app.get('/x', { schema: { response: { 200: schema } } }, (_request, reply) =>
      reply.code(status as 200).send(payload),
    );
  });
}

async function strictBody(schema: unknown, payload: unknown, status = 200) {
  const { app } = await route('strict', schema, payload, status);
  const response = await app.inject('/x');
  return { status: response.statusCode, body: response.json() as { error?: string; message?: string } };
}

describe('strict mode', () => {
  it('passes a response the schema serializes byte for byte', async () => {
    const { app } = await route('strict', obj({ a: { type: 'string' }, n: { type: ['integer', 'null'] } }), { a: 'x', n: null });
    const response = await app.inject('/x');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"a":"x","n":null}');
  });

  it.each([
    ['a dropped undeclared field', obj({ a: { type: 'string' } }), { a: 'x', b: 1 }],
    ['null under string (→ "")', obj({ a: { type: 'string' } }), { a: null }],
    ['null under integer (→ 0)', obj({ n: { type: 'integer' } }), { n: null }],
    ['a bare object (emptied)', obj({ o: { type: 'object' } }), { o: { k: 1 } }],
    ['a number under string (coerced)', obj({ a: { type: 'string' } }), { a: 5 }],
    ['a numeric string under integer (coerced)', obj({ n: { type: 'integer' } }), { n: '7' }],
    ['a reordered object', obj({ b: { type: 'number' }, a: { type: 'number' } }), { a: 1, b: 2 }],
  ])('fails %s with 500 CONTRACT_VIOLATION', async (_name, schema, payload) => {
    const { status, body } = await strictBody(schema, payload);
    expect(status).toBe(500);
    expect(body.error).toBe('CONTRACT_VIOLATION');
    expect(body.message).toContain('GET /x');
  });

  it('validates the JSON a client receives, not the object: a Date under string is the same ISO text', async () => {
    // Validating the object would call a Date "not a string" — but both
    // JSON.stringify and the serializer write it as the same ISO string, so
    // the client sees identical bytes and there is nothing to fail.
    const { app } = await route('strict', obj({ d: { type: 'string' } }), { d: new Date(0) });
    const response = await app.inject('/x');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"d":"1970-01-01T00:00:00.000Z"}');
  });

  it('fails a status the route does not declare', async () => {
    const { status, body } = await strictBody(obj({ a: { type: 'string' } }), { a: 'x' }, 202);
    expect(status).toBe(500);
    expect(body.message).toContain('status 202 is not declared');
  });

  it('accepts a status declared by a 4xx-style range or default', async () => {
    const { app } = await build('strict', (instance) => {
      instance.get('/r', { schema: { response: { '4xx': obj({ e: { type: 'string' } }) } } }, (_q, reply) =>
        reply.code(418).send({ e: 'teapot' }),
      );
    });
    expect((await app.inject('/r')).statusCode).toBe(418);
  });

  it('exempts 5xx and HEAD from the declared-status rule', async () => {
    const { app } = await build('strict', (instance) => {
      instance.get('/boom', { schema: { response: { 200: obj({}) } } }, (_q, reply) => reply.code(503 as 200).send({ x: 1 }));
    });
    expect((await app.inject('/boom')).statusCode).toBe(503);
    expect((await app.inject({ method: 'HEAD', url: '/boom' })).statusCode).toBe(503);
  });

  it('lets strings and streams through, checking their status only', async () => {
    const { app } = await build('strict', (instance) => {
      instance.get('/text', { schema: { response: { 200: { type: 'string' } } } }, (_q, reply) =>
        reply.type('text/markdown').send('# raw\n'),
      );
      instance.get('/stream', { schema: { response: { 200: { type: 'string' } } } }, (_q, reply) =>
        reply.type('application/octet-stream').send(Readable.from(['abc'])),
      );
    });
    expect((await app.inject('/text')).body).toBe('# raw\n');
    expect((await app.inject('/stream')).body).toBe('abc');
  });

  it('leaves a route with no response schema alone', async () => {
    const { app } = await build('strict', (instance) => {
      instance.get('/free', (_q, reply) => reply.code(299).send({ anything: [1, null] }));
    });
    const response = await app.inject('/free');
    expect(response.statusCode).toBe(299);
    expect(response.body).toBe('{"anything":[1,null]}');
  });

  it('checks the error responses an error handler sends', async () => {
    const { app } = await build('strict', (instance) => {
      instance.get(
        '/v',
        {
          schema: {
            querystring: { type: 'object', properties: { n: { type: 'integer' } } },
            response: { 200: obj({}) },
          },
        },
        () => ({}),
      );
    });
    // 400 is not declared, so the validation error itself is a violation.
    const response = await app.inject('/v?n=nope');
    expect(response.statusCode).toBe(500);
    expect((response.json() as { message: string }).message).toContain('status 400 is not declared');
  });
});

describe('fallback mode', () => {
  it('sends the original bytes and logs where they diverged — never the values', async () => {
    const secret = 'the contents of a private document';
    const { app, lines } = await route('fallback', obj({ title: { type: 'string' } }), { title: null, body: secret });
    const response = await app.inject('/x');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(JSON.stringify({ title: null, body: secret }));
    expect(response.headers['content-length']).toBe(String(Buffer.byteLength(response.body)));

    const warning = lines.find((line) => line.msg === 'contract mismatch');
    expect(warning).toMatchObject({ route: '/x', method: 'GET', status: 200, pointer: '/title' });
    expect(JSON.stringify(lines)).not.toContain(secret);
  });

  it('is silent when the bytes already match, and never 500s an undeclared status', async () => {
    const { app, lines } = await route('fallback', obj({ a: { type: 'string' } }), { a: 'x' }, 202);
    const response = await app.inject('/x');
    expect(response.statusCode).toBe(202);
    expect(lines.filter((line) => line.msg === 'contract mismatch')).toEqual([]);
  });
});

describe('off mode', () => {
  it('runs no hooks: the schema serializes as Fastify would', async () => {
    const { app } = await route('off', obj({ a: { type: 'string' } }), { a: 'x', b: 1 });
    expect((await app.inject('/x')).body).toBe('{"a":"x"}');
  });
});

describe('strictify', () => {
  it('closes objects that declare properties, deeply, and respects an explicit choice', () => {
    const schema = obj(
      {
        list: { type: 'array', items: obj({ a: { type: 'string' } }) },
        free: { type: 'object', additionalProperties: true },
        either: { anyOf: [obj({ x: { type: 'string' } }), { type: 'null' }] },
      },
      { required: ['list'] },
    );
    expect(strictify(schema)).toEqual({
      ...schema,
      additionalProperties: false,
      properties: {
        list: { type: 'array', items: { ...obj({ a: { type: 'string' } }), additionalProperties: false } },
        free: { type: 'object', additionalProperties: true },
        either: { anyOf: [{ ...obj({ x: { type: 'string' } }), additionalProperties: false }, { type: 'null' }] },
      },
    });
  });
});

describe('firstDifference', () => {
  it('points at the first differing value, key order included', () => {
    expect(firstDifference('{"a":1,"b":[1,2]}', '{"a":1,"b":[1,3]}')).toBe('/b/1');
    expect(firstDifference('{"a":null}', '{"a":""}')).toBe('/a');
    expect(firstDifference('{"a":1,"b":2}', '{"b":2,"a":1}')).toBe('/a (key order)');
    expect(firstDifference('{"a":1,"b":2}', '{"a":1}')).toBe('/b');
    expect(firstDifference('{"a/b":1}', '{"a/b":2}')).toBe('/a~1b');
  });
});
