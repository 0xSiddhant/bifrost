import { describe, expect, it } from 'vitest';
import { parseRange } from './range.js';

const SIZE = 100;

describe('parseRange', () => {
  it.each([
    ['bytes=0-49', 0, 49],
    ['bytes=50-99', 50, 99],
    ['bytes=50-', 50, 99], // open-ended
    ['bytes=0-', 0, 99],
    ['bytes=99-', 99, 99], // last byte
    ['bytes=-30', 70, 99], // suffix
    ['bytes=-100', 0, 99], // suffix covering whole file
    ['bytes=-500', 0, 99], // suffix larger than file → whole file
    ['bytes=0-0', 0, 0],
    ['bytes=10-500', 10, 99], // end clamped to size
    [' bytes=5-9 ', 5, 9], // whitespace tolerated
  ])('%s → partial %d..%d', (header, start, end) => {
    expect(parseRange(header, SIZE)).toEqual({ kind: 'partial', range: { start, end } });
  });

  it.each([
    [undefined],
    ['bytes=-'], // empty on both sides
    ['bytes=abc-def'],
    ['bytes=5-3'], // end before start → ignore per spec
    ['items=0-10'], // wrong unit
    ['bytes=0-10,20-30'], // multi-range → serve full
    ['0-10'],
  ])('%s → full response', (header) => {
    expect(parseRange(header, SIZE)).toEqual({ kind: 'full' });
  });

  it.each([
    ['bytes=100-', SIZE], // start at size
    ['bytes=100-200', SIZE],
    ['bytes=5000-', SIZE],
    ['bytes=-0', SIZE], // zero-length suffix
    ['bytes=0-', 0], // any range against an empty file
    ['bytes=-5', 0],
  ])('%s (size %d) → unsatisfiable', (header, size) => {
    expect(parseRange(header, size)).toEqual({ kind: 'unsatisfiable' });
  });
});
