import { describe, expect, it } from 'vitest';
import { convertCase, slugify, splitWords } from './textCase';

describe('splitWords', () => {
  it('splits every convention into the same words', () => {
    const expected = ['http', 'response', 'code'];
    for (const input of [
      'httpResponseCode',
      'HttpResponseCode',
      'http_response_code',
      'http-response-code',
      'HTTP_RESPONSE_CODE',
      'http response code',
    ]) {
      expect(splitWords(input).map((w) => w.toLowerCase())).toEqual(expected);
    }
  });

  it('keeps a run of capitals together and cuts only its tail', () => {
    expect(splitWords('HTTPResponse')).toEqual(['HTTP', 'Response']);
    expect(splitWords('parseXMLFile')).toEqual(['parse', 'XML', 'File']);
    expect(splitWords('IOError')).toEqual(['IO', 'Error']);
  });

  it('keeps digits attached to their word', () => {
    expect(splitWords('base64Encode')).toEqual(['base64', 'Encode']);
    expect(splitWords('utf8')).toEqual(['utf8']);
  });

  it('drops punctuation runs instead of emitting empty words', () => {
    expect(splitWords('  hello___world -- again ')).toEqual(['hello', 'world', 'again']);
    expect(splitWords('')).toEqual([]);
    expect(splitWords('---')).toEqual([]);
  });

  it('does not split a word on its own accent', () => {
    expect(splitWords('Crème Brûlée')).toEqual(['Crème', 'Brûlée']);
    expect(splitWords('naïveApproach')).toEqual(['naïve', 'Approach']);
  });
});

describe('convertCase', () => {
  it('produces every form from one input', () => {
    expect(convertCase('http response code')).toEqual({
      camel: 'httpResponseCode',
      pascal: 'HttpResponseCode',
      snake: 'http_response_code',
      kebab: 'http-response-code',
      constant: 'HTTP_RESPONSE_CODE',
      title: 'Http Response Code',
      sentence: 'Http response code',
      slug: 'http-response-code',
      lower: 'http response code',
      upper: 'HTTP RESPONSE CODE',
    });
  });

  it('is idempotent — converting a form back to itself round-trips', () => {
    const first = convertCase('userIdToken');
    expect(convertCase(first.snake).camel).toBe('userIdToken');
    expect(convertCase(first.constant).camel).toBe('userIdToken');
    expect(convertCase(first.kebab).pascal).toBe('UserIdToken');
  });

  it('returns empty forms for empty input rather than stray separators', () => {
    const forms = convertCase('   ');
    expect(forms.camel).toBe('');
    expect(forms.snake).toBe('');
    expect(forms.title).toBe('');
    expect(forms.sentence).toBe('');
  });
});

describe('slugify', () => {
  it('folds diacritics to ASCII instead of dropping the letters', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
    expect(slugify('naïve café')).toBe('naive-cafe');
  });

  it('uses the same word split as every other form', () => {
    // Slugging the raw string would give "httpresponsecode" — there are no
    // separators in a camelCase input to slug on.
    expect(slugify('HTTPResponseCode')).toBe('http-response-code');
    expect(slugify('userIdToken')).toBe('user-id-token');
  });

  it('returns empty for a script that has no ASCII form', () => {
    expect(slugify('日本語')).toBe('');
  });

  it('collapses runs and trims the ends', () => {
    expect(slugify('  Hello,   World!!  ')).toBe('hello-world');
    expect(slugify('--already--slugged--')).toBe('already-slugged');
  });

  it('keeps digits and returns empty when nothing survives', () => {
    expect(slugify('Plan 18 — Toolbox')).toBe('plan-18-toolbox');
    expect(slugify('!!!')).toBe('');
  });
});
