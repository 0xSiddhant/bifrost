import { describe, expect, it } from 'vitest';
import {
  formatUuid,
  generateUuids,
  stampVersion,
  timestampFromV7,
  uuidV4,
  uuidV7,
} from './uuid';

const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('formatUuid', () => {
  it('lays 16 bytes out as 8-4-4-4-12', () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(formatUuid(bytes)).toBe('00010203-0405-0607-0809-0a0b0c0d0e0f');
  });

  it('zero-pads single-digit bytes', () => {
    expect(formatUuid(new Uint8Array(16))).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('stampVersion', () => {
  it('sets the version nibble and the RFC 4122 variant bits, keeping the rest', () => {
    const bytes = new Uint8Array(16).fill(0xff);
    stampVersion(bytes, 4);
    expect(bytes[6]).toBe(0x4f);
    expect(bytes[8]).toBe(0xbf);
    expect(bytes[7]).toBe(0xff);
  });

  it('works from all-zero bytes too', () => {
    const bytes = new Uint8Array(16);
    stampVersion(bytes, 7);
    expect(bytes[6]).toBe(0x70);
    expect(bytes[8]).toBe(0x80);
  });
});

describe('uuidV4', () => {
  it('is canonical, version 4, variant 10xx', () => {
    for (let i = 0; i < 50; i += 1) {
      const uuid = uuidV4();
      expect(uuid).toMatch(CANONICAL);
      expect(uuid[14]).toBe('4');
      expect('89ab').toContain(uuid[19]);
    }
  });

  it('does not repeat', () => {
    const many = new Set(Array.from({ length: 500 }, uuidV4));
    expect(many.size).toBe(500);
  });
});

describe('uuidV7', () => {
  it('is canonical, version 7, variant 10xx', () => {
    const uuid = uuidV7();
    expect(uuid).toMatch(CANONICAL);
    expect(uuid[14]).toBe('7');
    expect('89ab').toContain(uuid[19]);
  });

  it('carries the 48-bit millisecond timestamp, past the 32-bit boundary', () => {
    const now = Date.UTC(2026, 7, 6, 11, 7, 0);
    expect(timestampFromV7(uuidV7(now))).toBe(now);
    // 0x100000000 ms ≈ 1972 — the split-vs-shift case.
    expect(timestampFromV7(uuidV7(0x100000000))).toBe(0x100000000);
    expect(timestampFromV7(uuidV7(0))).toBe(0);
  });

  it('sorts lexically by creation time — the reason to pick v7', () => {
    const early = uuidV7(Date.UTC(2020, 0, 1));
    const late = uuidV7(Date.UTC(2026, 0, 1));
    expect([late, early].sort()).toEqual([early, late]);
  });

  it('refuses a negative clock instead of encoding garbage', () => {
    expect(timestampFromV7(uuidV7(-5))).toBe(0);
  });

  it('reads no timestamp out of a v4', () => {
    expect(timestampFromV7(uuidV4())).toBeNull();
    expect(timestampFromV7('nonsense')).toBeNull();
  });
});

describe('generateUuids', () => {
  it('honours count, version and case', () => {
    expect(generateUuids('v4', 5, false)).toHaveLength(5);
    expect(generateUuids('v7', 3, true).every((u) => u === u.toUpperCase())).toBe(true);
    expect(generateUuids('v7', 1, false)[0]?.charAt(14)).toBe('7');
  });

  it('clamps the count to 1..100 rather than hanging on a pasted number', () => {
    expect(generateUuids('v4', 0, false)).toHaveLength(1);
    expect(generateUuids('v4', -3, false)).toHaveLength(1);
    expect(generateUuids('v4', 5000, false)).toHaveLength(100);
    expect(generateUuids('v4', Number.NaN, false)).toHaveLength(1);
  });
});
