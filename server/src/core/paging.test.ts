import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { AppError } from './http/index.js';
import { registerContractCheck } from './http/contract.js';
import {
  cursorListPageSchema,
  decodeCursor,
  documentListPageSchema,
  encodeCursor,
  pageLimit,
} from './paging.js';

const PAGING = { pageSize: 30, maxPageSize: 100 };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? `${error.statusCode} ${error.code}` : 'not an AppError';
  }
  return undefined;
}

describe('pageLimit', () => {
  it('defaults to the configured page size', () => {
    expect(pageLimit(undefined, PAGING)).toBe(30);
  });

  it('clamps into [1, maxPageSize]', () => {
    expect(pageLimit(500, PAGING)).toBe(100);
    expect(pageLimit(0, PAGING)).toBe(1);
    expect(pageLimit(-4, PAGING)).toBe(1);
    expect(pageLimit(42, PAGING)).toBe(42);
  });
});

describe('cursor codec', () => {
  it('round-trips a string key and a numeric key', () => {
    const text = encodeCursor('title', 'asc', { key: 'ärger & co', id: 'ab12cd' });
    expect(decodeCursor(text, 'title', 'asc', 'string')).toEqual({
      key: 'ärger & co',
      id: 'ab12cd',
    });
    const time = encodeCursor('created', 'desc', { key: 1_700_000_000_123, id: 'router' });
    expect(decodeCursor(time, 'created', 'desc', 'number')).toEqual({
      key: 1_700_000_000_123,
      id: 'router',
    });
  });

  it('is url-safe', () => {
    const cursor = encodeCursor('title', 'asc', { key: '???>>>~~~', id: 'x' });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('refuses a cursor minted under another sort or order', () => {
    const cursor = encodeCursor('created', 'desc', { key: 5, id: 'a' });
    expect(codeOf(() => decodeCursor(cursor, 'created', 'asc', 'number'))).toBe('400 BAD_CURSOR');
    expect(codeOf(() => decodeCursor(cursor, 'title', 'desc', 'string'))).toBe('400 BAD_CURSOR');
  });

  it('refuses garbage and tampered payloads', () => {
    expect(codeOf(() => decodeCursor('not-a-cursor', 'created', 'desc', 'number'))).toBe(
      '400 BAD_CURSOR',
    );
    const noId = Buffer.from(JSON.stringify({ sort: 'created', order: 'desc', key: 1 })).toString(
      'base64url',
    );
    expect(codeOf(() => decodeCursor(noId, 'created', 'desc', 'number'))).toBe('400 BAD_CURSOR');
    const objectKey = Buffer.from(
      JSON.stringify({ sort: 'created', order: 'desc', key: { $gt: 1 }, id: 'a' }),
    ).toString('base64url');
    expect(codeOf(() => decodeCursor(objectKey, 'created', 'desc', 'number'))).toBe(
      '400 BAD_CURSOR',
    );
    const stringUnderTime = Buffer.from(
      JSON.stringify({ sort: 'created', order: 'desc', key: '17', id: 'a' }),
    ).toString('base64url');
    expect(codeOf(() => decodeCursor(stringUnderTime, 'created', 'desc', 'number'))).toBe(
      '400 BAD_CURSOR',
    );
    const array = Buffer.from('[1,2]').toString('base64url');
    expect(codeOf(() => decodeCursor(array, 'created', 'desc', 'number'))).toBe('400 BAD_CURSOR');
  });
});

describe('envelope response schemas', () => {
  const item = {
    type: 'object',
    properties: { id: { type: 'string' }, at: { type: ['integer', 'null'] } },
  } as const;

  /** Serve `payload` under `schema` with the strict contract guard: 200 means byte-identical. */
  async function serve(
    schema: object,
    payload: unknown,
  ): Promise<{ status: number; body: string }> {
    const app = Fastify() as unknown as FastifyInstance;
    registerContractCheck(app, 'strict', pino({ level: 'silent' }));
    app.get('/page', { schema: { response: { 200: schema } } }, () => payload);
    const response = await app.inject('/page');
    await app.close();
    return { status: response.statusCode, body: response.body };
  }

  it('documentListPageSchema serializes a usecase envelope byte for byte', async () => {
    const page = {
      items: [
        { id: 'a', at: null },
        { id: 'b', at: 2 },
      ],
      total: 7,
      limit: 2,
      offset: 4,
      authors: ['device-1'],
    };
    expect(await serve(documentListPageSchema(item), page)).toEqual({
      status: 200,
      body: JSON.stringify(page),
    });
  });

  it('cursorListPageSchema keeps a null cursor and appends the extras after it', async () => {
    const page = {
      items: [{ id: 'a', at: 1 }],
      total: 1,
      limit: 30,
      nextCursor: null,
      tags: ['x'],
    };
    const schema = cursorListPageSchema(item, {
      tags: { type: 'array', items: { type: 'string' } },
    });
    expect(schema.required).toEqual(['items', 'total', 'limit', 'nextCursor', 'tags']);
    expect(await serve(schema, page)).toEqual({ status: 200, body: JSON.stringify(page) });
    expect((await serve(cursorListPageSchema(item), { ...page, tags: undefined })).status).toBe(
      200,
    );
  });
});
