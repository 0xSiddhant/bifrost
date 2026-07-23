import { describe, expect, it } from 'vitest';
import { stats } from './stats';

describe('stats', () => {
  it('counts words and code points', () => {
    const s = stats('hello world foo');
    expect(s.words).toBe(3);
    expect(s.chars).toBe(15);
  });

  it('is empty for whitespace-only input', () => {
    expect(stats('   \n\t ')).toEqual({ words: 0, chars: 6, readingMinutes: 0 });
  });

  it('estimates reading time at ~200 wpm, at least a minute for any prose', () => {
    expect(stats('word '.repeat(10).trim()).readingMinutes).toBe(1);
    expect(stats('word '.repeat(600).trim()).readingMinutes).toBe(3);
  });

  it('counts emoji as single code points', () => {
    expect(stats('🚀🚀').chars).toBe(2);
  });
});
