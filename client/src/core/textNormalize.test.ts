import { describe, expect, it } from 'vitest';
import { hasActiveNormalization, normalizeText } from './textNormalize';

describe('normalizeText', () => {
  it('normalizes CRLF and lone CR to LF by default (acceptance 7)', () => {
    expect(normalizeText('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });

  it('leaves line endings alone when normalizeEol is off', () => {
    expect(normalizeText('a\r\nb', { normalizeEol: false })).toBe('a\r\nb');
  });

  it('trims leading and trailing whitespace per line', () => {
    expect(normalizeText('  a \t\nb  ', { trimLines: true })).toBe('a\nb');
  });

  it('strips every space and tab run', () => {
    expect(normalizeText('a b\tc\n d e ', { stripWhitespace: true })).toBe('abc\nde');
  });

  it('lowercases when ignoreCase is on', () => {
    expect(normalizeText('AbC', { ignoreCase: true })).toBe('abc');
  });

  it('drops blank lines, including whitespace-only ones', () => {
    expect(normalizeText('a\n\n  \nb', { dropBlankLines: true })).toBe('a\nb');
  });

  it('composes options deterministically', () => {
    const input = ' A b \r\n\r\n\tC D ';
    expect(
      normalizeText(input, { trimLines: true, ignoreCase: true, dropBlankLines: true }),
    ).toBe('a b\nc d');
  });

  it('is idempotent for any option set', () => {
    const optionSets = [
      {},
      { trimLines: true },
      { stripWhitespace: true },
      { ignoreCase: true, dropBlankLines: true },
      { trimLines: true, ignoreCase: true, dropBlankLines: true },
    ];
    const input = '  Mixed \r\n\r\n\tCase\tLines \r\n end ';
    for (const options of optionSets) {
      const once = normalizeText(input, options);
      expect(normalizeText(once, options)).toBe(once);
    }
  });
});

describe('hasActiveNormalization', () => {
  it('EOL normalization alone is not "active" (it is always-on baseline)', () => {
    expect(hasActiveNormalization({ normalizeEol: true })).toBe(false);
    expect(hasActiveNormalization({})).toBe(false);
  });

  it('any destructive option counts', () => {
    expect(hasActiveNormalization({ trimLines: true })).toBe(true);
    expect(hasActiveNormalization({ ignoreCase: true })).toBe(true);
  });
});
