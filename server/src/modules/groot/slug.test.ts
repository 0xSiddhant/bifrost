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
    expect(kebabName('Cluster Manifest')).toBe('cluster-manifest');
    expect(kebabName('Café Señor — Notes!')).toBe('cafe-senor-notes');
    expect(kebabName('x'.repeat(80))).toHaveLength(48);
  });

  it('does not leave a trailing dash when the clamp lands on a separator', () => {
    expect(kebabName(`${'x'.repeat(48)} tail`)).not.toMatch(/-$/);
  });

  it('builds `<kebab>-<id>` slugs and falls back to bare id when empty', () => {
    expect(makeSlug('Deploy Values', 'abc123')).toBe('deploy-values-abc123');
    expect(makeSlug('!!!', 'abc123')).toBe('abc123');
  });

  it('extracts an id-shaped tail, or null', () => {
    expect(idFromSlug('deploy-values-abc123')).toBe('abc123');
    expect(idFromSlug('short-tail')).toBeNull();
    expect(idFromSlug('api')).toBeNull();
  });

  it('guards reserved bare segments but lets real slugs through', () => {
    expect(isReservedSlug('api')).toBe(true);
    expect(isReservedSlug('library')).toBe(true);
    expect(isReservedSlug('pensieve')).toBe(true);
    // a real slug that happens to start with a reserved word carries an id tail
    expect(isReservedSlug('api-abc123')).toBe(false);
    expect(isReservedSlug('values')).toBe(false);
  });
});
