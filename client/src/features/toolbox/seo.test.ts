import { describe, expect, it } from 'vitest';
import { SEO_PAGES } from '../../core/seo';
import { TOOLS } from './registry';

describe('the public tool pages (core/seo.ts)', () => {
  it('are every in-place tool, in order, and none that needs the hub', () => {
    const inPlace = TOOLS.filter((tool) => tool.module === 'toolbox' && !tool.to);
    const listed = SEO_PAGES.filter((page) => page.path.startsWith('/diagon-alley/'));
    expect(listed.map((page) => page.path)).toEqual(
      inPlace.map((tool) => `/diagon-alley/${tool.id}`),
    );
  });
});
