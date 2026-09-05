import { describe, expect, it } from 'vitest';
import {
  compressedName,
  decompressedName,
  gzippedName,
  looksLikeText,
  savedPercent,
  TEXT_SAMPLE_BYTES,
  toBase64,
} from './bytes';

describe('looksLikeText', () => {
  it('reads ordinary text as text', () => {
    expect(looksLikeText(new TextEncoder().encode('hello, world'))).toBe(true);
  });

  it('reads a null byte in the sample as binary', () => {
    expect(looksLikeText(new Uint8Array([0x68, 0x00, 0x69]))).toBe(false);
  });

  it('samples a bounded prefix, never the whole blob', () => {
    // The only null byte sits well past the sample window. Reading "text" here
    // is the assertion: a scan that silently ran further would say binary, and
    // on a several-hundred-megabyte result that scan is the cost being avoided.
    const big = new Uint8Array(TEXT_SAMPLE_BYTES * 4).fill(0x61);
    big[TEXT_SAMPLE_BYTES + 10] = 0;
    expect(looksLikeText(big)).toBe(true);
  });
});

describe('toBase64', () => {
  it('round-trips bytes through the browser decoder', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });

  it('handles a blob far past one String.fromCharCode spread', () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 256);
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});

describe('names', () => {
  it('appends the extension, or invents one for pasted text', () => {
    expect(compressedName('notes.json')).toBe('notes.json.br');
    expect(compressedName(null)).toBe('compressed.br');
    expect(gzippedName('notes.json')).toBe('notes.json.gz');
    expect(gzippedName(null)).toBe('compressed.gz');
  });

  it('strips a trailing .br, and falls back to what the bytes actually are', () => {
    expect(decompressedName('notes.json.br', true)).toBe('notes.json');
    expect(decompressedName('NOTES.BR', true)).toBe('NOTES');
    expect(decompressedName('mystery', true)).toBe('decompressed.txt');
    expect(decompressedName('mystery', false)).toBe('decompressed.bin');
    expect(decompressedName(null, false)).toBe('decompressed.bin');
  });
});

describe('savedPercent', () => {
  it('reports how much smaller the result is', () => {
    expect(savedPercent(1000, 250)).toBe(75);
    expect(savedPercent(1000, 1000)).toBe(0);
    // Compression can grow already-compressed input; saying so beats hiding it.
    expect(savedPercent(100, 120)).toBe(-20);
    expect(savedPercent(0, 0)).toBe(0);
    // Never "100% smaller" for something that still has bytes in it.
    expect(savedPercent(13_209, 48)).toBe(99);
    expect(savedPercent(100, 0)).toBe(100);
  });
});
