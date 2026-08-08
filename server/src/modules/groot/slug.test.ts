import { describe, expect, it } from 'vitest';
import {
  GROOT_ID_LENGTH,
  idFromSlug,
  isReservedSlug,
  kebabName,
  makeSlug,
  newGrootId,
} from './slug.js';

describe('groot slug', () => {
  it('generates ids of the fixed length from the alphabet', () => {
    const id = newGrootId(() => 0.5);
    expect(id).toHaveLength(GROOT_ID_LENGTH);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it('kebabs names, stripping diacritics and clamping length', () => {
    expect(kebabName('Deployment Manifest')).toBe('deployment-manifest');
    expect(kebabName('Café Señor — Notes!')).toBe('cafe-senor-notes');
    expect(kebabName('x'.repeat(80))).toHaveLength(48);
  });

  it('builds `<kebab>-<id>` slugs and falls back to bare id when empty', () => {
    expect(makeSlug('Saga Notes', 'abc123')).toBe('saga-notes-abc123');
    expect(makeSlug('!!!', 'abc123')).toBe('abc123');
  });

  it('extracts an id-shaped tail, or null', () => {
    expect(idFromSlug('saga-notes-abc123')).toBe('abc123');
    expect(idFromSlug('short-tail')).toBeNull();
    expect(idFromSlug('pensieve')).toBeNull();
  });

  it('guards reserved bare segments but lets real slugs through', () => {
    expect(isReservedSlug('pensieve')).toBe(true);
    expect(isReservedSlug('api')).toBe(true);
    expect(isReservedSlug('library')).toBe(true);
    expect(isReservedSlug('pensieve')).toBe(true);
    // a real slug that happens to start with a reserved word carries an id tail
    expect(isReservedSlug('pensieve-abc123')).toBe(false);
    expect(isReservedSlug('notes')).toBe(false);
  });
});
