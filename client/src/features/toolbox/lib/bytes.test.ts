import { describe, expect, it } from 'vitest';
import { bytesToText, convertBase, textStats, textToBytes } from './bytes';

describe('textToBytes', () => {
  it('emits UTF-8 bytes, padded per notation', () => {
    expect(textToBytes('Hi', 'hex')).toBe('48 69');
    expect(textToBytes('Hi', 'binary')).toBe('01001000 01101001');
    expect(textToBytes('Hi', 'decimal')).toBe('72 105');
  });

  it('emits the multi-byte sequence for non-ASCII, not one byte per character', () => {
    expect(textToBytes('é', 'hex')).toBe('c3 a9');
    expect(textToBytes('🌉', 'hex')).toBe('f0 9f 8c 89');
  });
});

describe('bytesToText', () => {
  it('round-trips every notation', () => {
    for (const format of ['hex', 'binary', 'decimal'] as const) {
      for (const text of ['Hi', 'héllo 🌉', '']) {
        expect(bytesToText(textToBytes(text, format), format).value).toBe(text);
      }
    }
  });

  it('accepts unseparated hex and binary, which is how people paste them', () => {
    expect(bytesToText('4869', 'hex').value).toBe('Hi');
    expect(bytesToText('0x4869', 'hex').value).toBe('Hi');
    expect(bytesToText('0100100001101001', 'binary').value).toBe('Hi');
  });

  it('rejects an unseparated run that is not a whole number of bytes', () => {
    const result = bytesToText('486', 'hex');
    expect(result.value).toBe('');
    expect(result.error).toMatch(/groups of 2/);
  });

  it('accepts commas as well as spaces', () => {
    expect(bytesToText('72, 105', 'decimal').value).toBe('Hi');
  });

  it('rejects a value that is not a byte', () => {
    expect(bytesToText('300 105', 'decimal').error).toMatch(/not a byte/);
    expect(bytesToText('zz', 'hex').error).toMatch(/not a byte/);
  });

  it('rejects bytes that are not valid UTF-8 rather than showing replacement chars', () => {
    const result = bytesToText('ff', 'hex');
    expect(result.error).toMatch(/not valid UTF-8/);
    expect(result.value).not.toContain('�');
  });
});

describe('convertBase', () => {
  it('converts between all four bases', () => {
    expect(convertBase('255', 10)).toEqual({
      binary: '11111111',
      octal: '377',
      decimal: '255',
      hex: 'FF',
    });
    expect(convertBase('ff', 16)?.decimal).toBe('255');
    expect(convertBase('11111111', 2)?.hex).toBe('FF');
    expect(convertBase('377', 8)?.decimal).toBe('255');
  });

  it('keeps every digit of a value past Number.MAX_SAFE_INTEGER', () => {
    // A 64-bit snowflake id: Number would round the tail away.
    const decimal = '1234567890123456789012345';
    const converted = convertBase(decimal, 10);
    expect(converted?.decimal).toBe(decimal);
    expect(converted?.hex).toBe(BigInt(decimal).toString(16).toUpperCase());
    expect(Number(decimal).toString()).not.toBe(decimal); // proves the hazard is real
  });

  it('strips the prefixes and separators people paste', () => {
    expect(convertBase('0xFF', 16)?.decimal).toBe('255');
    expect(convertBase('0b1010', 2)?.decimal).toBe('10');
    expect(convertBase('1_000', 10)?.decimal).toBe('1000');
  });

  it('rejects digits that are not legal in the source base', () => {
    expect(convertBase('2', 2)).toBeNull();
    expect(convertBase('8', 8)).toBeNull();
    expect(convertBase('g', 16)).toBeNull();
    expect(convertBase('', 10)).toBeNull();
    expect(convertBase('-5', 10)).toBeNull();
  });
});

describe('textStats', () => {
  it('separates bytes, UTF-16 length and code points', () => {
    // '🌉' is 4 UTF-8 bytes, 2 UTF-16 units, 1 code point.
    expect(textStats('🌉')).toEqual({
      bytes: 4,
      characters: 2,
      graphemes: 1,
      words: 1,
      lines: 1,
    });
  });

  it('counts words and lines the way a person would', () => {
    expect(textStats('one two  three')).toMatchObject({ words: 3, lines: 1 });
    expect(textStats('a\nb\nc')).toMatchObject({ words: 3, lines: 3 });
    expect(textStats('  padded  ')).toMatchObject({ words: 1 });
  });

  it('reports zeroes for empty text rather than one empty word', () => {
    expect(textStats('')).toEqual({ bytes: 0, characters: 0, graphemes: 0, words: 0, lines: 0 });
    expect(textStats('   ')).toMatchObject({ words: 0 });
  });
});
