import { describe, expect, it } from 'vitest';
import { markLeftOpen, takeLeftOpen } from './draftReturn';

describe('draftReturn', () => {
  it('is silent about an editor that was never left open', () => {
    expect(takeLeftOpen('never-visited')).toBe(false);
  });

  it('reports an editor that was left open', () => {
    markLeftOpen('groot-a');
    expect(takeLeftOpen('groot-a')).toBe(true);
  });

  it('applies to exactly one return, so a later fresh visit still prompts', () => {
    markLeftOpen('groot-b');
    expect(takeLeftOpen('groot-b')).toBe(true);
    expect(takeLeftOpen('groot-b')).toBe(false);
  });

  it('keeps editors independent — leaving Groot says nothing about Runestone', () => {
    markLeftOpen('groot-c');
    expect(takeLeftOpen('runestone-c')).toBe(false);
    expect(takeLeftOpen('groot-c')).toBe(true);
  });

  it('is idempotent, so a double-invoked effect cannot bank two returns', () => {
    markLeftOpen('groot-d');
    markLeftOpen('groot-d');
    expect(takeLeftOpen('groot-d')).toBe(true);
    expect(takeLeftOpen('groot-d')).toBe(false);
  });
});
