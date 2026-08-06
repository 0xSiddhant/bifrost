import { describe, expect, it } from 'vitest';
import { buildAlphabet, estimateStrength, generatePassword, type CharsetOptions } from './secret';

const ALL: CharsetOptions = {
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

describe('buildAlphabet', () => {
  it('includes only the selected sets', () => {
    expect(buildAlphabet({ ...ALL, upper: false, digits: false, symbols: false })).toBe(
      'abcdefghijklmnopqrstuvwxyz',
    );
    expect(buildAlphabet({ ...ALL, lower: false, upper: false, symbols: false })).toBe('0123456789');
  });

  it('removes the characters people mistype off a screen', () => {
    const alphabet = buildAlphabet({ ...ALL, avoidAmbiguous: true });
    for (const char of ['0', 'O', 'o', '1', 'l', 'I']) expect(alphabet).not.toContain(char);
    expect(alphabet).toContain('a');
  });

  it('is empty when nothing is selected', () => {
    expect(
      buildAlphabet({ lower: false, upper: false, digits: false, symbols: false, avoidAmbiguous: false }),
    ).toBe('');
  });
});

describe('generatePassword', () => {
  it('produces the requested length from the selected alphabet only', () => {
    const digitsOnly: CharsetOptions = { ...ALL, lower: false, upper: false, symbols: false };
    const password = generatePassword(24, digitsOnly);
    expect(password).toHaveLength(24);
    expect(password).toMatch(/^\d{24}$/);
  });

  it('clamps a nonsense length instead of hanging or returning nothing', () => {
    expect(generatePassword(0, ALL)).toHaveLength(1);
    expect(generatePassword(-5, ALL)).toHaveLength(1);
    expect(generatePassword(9999, ALL)).toHaveLength(256);
    expect(generatePassword(Number.NaN, ALL)).toHaveLength(1);
  });

  it('returns empty when no charset is selected, rather than looping forever', () => {
    expect(
      generatePassword(16, {
        lower: false, upper: false, digits: false, symbols: false, avoidAmbiguous: false,
      }),
    ).toBe('');
  });

  it('does not repeat itself', () => {
    const many = new Set(Array.from({ length: 200 }, () => generatePassword(16, ALL)));
    expect(many.size).toBe(200);
  });

  it('is close to uniform — the reason for rejection sampling over modulo', () => {
    // 24 symbols do not divide 256, so `byte % 24` would over-weight the first
    // 16 characters by ~1.5x. Draw enough samples that such a skew is obvious.
    const symbolsOnly: CharsetOptions = {
      lower: false, upper: false, digits: false, symbols: true, avoidAmbiguous: false,
    };
    const alphabet = buildAlphabet(symbolsOnly);
    const counts = new Map<string, number>();
    const total = 24000;
    let drawn = 0;
    while (drawn < total) {
      for (const char of generatePassword(256, symbolsOnly)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
        drawn += 1;
      }
    }
    const head = [...alphabet.slice(0, 16)].reduce((sum, c) => sum + (counts.get(c) ?? 0), 0);
    const tail = [...alphabet.slice(16)].reduce((sum, c) => sum + (counts.get(c) ?? 0), 0);
    const headPerChar = head / 16;
    const tailPerChar = tail / (alphabet.length - 16);
    // Modulo bias would put this ratio near 1.5; uniform keeps it near 1.
    expect(headPerChar / tailPerChar).toBeGreaterThan(0.85);
    expect(headPerChar / tailPerChar).toBeLessThan(1.15);
  });
});

describe('estimateStrength', () => {
  it('is length x log2(alphabet)', () => {
    const digitsOnly: CharsetOptions = { ...ALL, lower: false, upper: false, symbols: false };
    expect(estimateStrength(10, digitsOnly)).toMatchObject({ alphabetSize: 10, bits: 33 });
    const lowerOnly: CharsetOptions = { ...ALL, upper: false, digits: false, symbols: false };
    expect(estimateStrength(20, lowerOnly).bits).toBe(Math.round(20 * Math.log2(26)));
  });

  it('labels the bands', () => {
    expect(estimateStrength(4, ALL).label).toBe('weak');
    expect(estimateStrength(10, ALL).label).toBe('fair');
    expect(estimateStrength(14, ALL).label).toBe('strong');
    expect(estimateStrength(24, ALL).label).toBe('very strong');
  });

  it('reports zero bits when nothing is selected', () => {
    expect(
      estimateStrength(16, {
        lower: false, upper: false, digits: false, symbols: false, avoidAmbiguous: false,
      }),
    ).toMatchObject({ bits: 0, alphabetSize: 0 });
  });
});
