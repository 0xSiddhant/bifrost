import { describe, expect, it } from 'vitest';
import {
  compareCaptured,
  compareRuns,
  firstDifference,
  normaliseCaptured,
  TokenTable,
  type Captured,
} from './compare.js';

const json = (request: string, value: unknown, headers: Record<string, string> = {}): Captured => ({
  request,
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  body: Buffer.from(JSON.stringify(value)),
});

describe('firstDifference', () => {
  it('finds the first differing byte, a length difference, or none', () => {
    expect(firstDifference(Buffer.from('abc'), Buffer.from('abc'))).toBe(-1);
    expect(firstDifference(Buffer.from('abc'), Buffer.from('abd'))).toBe(2);
    expect(firstDifference(Buffer.from('ab'), Buffer.from('abc'))).toBe(2);
  });
});

describe('compareCaptured', () => {
  it('is silent for byte-identical responses', () => {
    expect(compareCaptured(json('GET /a', { a: 1 }), json('GET /a', { a: 1 }))).toEqual([]);
  });

  it('reports status, compared headers and body bytes — including key order and null → ""', () => {
    const base = json('GET /a', { title: null, n: 1 }, { location: '/x' });
    const candidate: Captured = {
      ...json('GET /a', { n: 1, title: '' }, { location: '/y' }),
      status: 201,
    };
    const what = compareCaptured(base, candidate).map((difference) => difference.what);
    expect(what).toEqual(['status', 'header', 'body']);
  });

  it('ignores headers outside the compared set', () => {
    const base = json('GET /a', {}, { date: 'Mon' });
    const candidate = json('GET /a', {}, { date: 'Tue' });
    expect(compareCaptured(base, candidate)).toEqual([]);
  });
});

describe('compareRuns', () => {
  it('reports a request the candidate never answered', () => {
    expect(compareRuns([json('GET /a', 1)], [])).toEqual([
      expect.objectContaining({ what: 'missing' }),
    ]);
  });
});

describe('normaliseCaptured', () => {
  it('maps each side’s generated ids to the same placeholders, everywhere they appear', () => {
    const sideA = new TokenTable();
    const sideB = new TokenTable();
    const a = normaliseCaptured(
      json(
        'POST /api/edda',
        { id: 'abc123', slug: 'notes-abc123', createdAt: 1, name: 'notes' },
        { location: '/edda/notes-abc123' },
      ),
      sideA,
    );
    const b = normaliseCaptured(
      json(
        'POST /api/edda',
        { id: 'xyz789', slug: 'notes-xyz789', createdAt: 2, name: 'notes' },
        { location: '/edda/notes-xyz789' },
      ),
      sideB,
    );
    expect(compareCaptured(a, b)).toEqual([]);
    expect(a.body.toString()).toBe(
      '{"id":"<id:1>","slug":"<slug:2>","createdAt":"<time>","name":"notes"}',
    );
  });

  it('still catches a real difference after normalising', () => {
    const a = normaliseCaptured(json('GET /x', { id: 'abc123', title: null }), new TokenTable());
    const b = normaliseCaptured(json('GET /x', { id: 'xyz789', title: '' }), new TokenTable());
    expect(compareCaptured(a, b)).toEqual([expect.objectContaining({ what: 'body' })]);
  });

  it('keeps key order, so a reordered object is a difference', () => {
    const a = normaliseCaptured(json('GET /x', { a: 1, b: 2 }), new TokenTable());
    const b = normaliseCaptured(json('GET /x', { b: 2, a: 1 }), new TokenTable());
    expect(compareCaptured(a, b)).toHaveLength(1);
  });
});

describe('canonicalZip', () => {
  /** A central-directory record carrying only the fields canonicalZip reads. */
  const record = (name: string, crc: number, size: number) => {
    const header = Buffer.alloc(46);
    header.write('PK\x01\x02', 0, 'latin1');
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(Buffer.byteLength(name), 28);
    return Buffer.concat([header, Buffer.from(name)]);
  };
  const zip = (...records: Buffer[]): Captured => ({
    request: 'GET /archive',
    status: 200,
    headers: { 'content-type': 'application/zip' },
    body: Buffer.concat(records),
  });

  it('ignores entry order but not contents', () => {
    const a = record('a.txt', 0x11, 3);
    const b = record('b.txt', 0x22, 4);
    expect(compareCaptured(zip(a, b), zip(b, a))).toEqual([]);
    expect(compareCaptured(zip(a, b), zip(a, record('b.txt', 0x23, 4)))).toHaveLength(1);
  });
});
