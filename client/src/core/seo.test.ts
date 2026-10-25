import { describe, expect, it } from 'vitest';
import { FEATURES, STANDALONE_FEATURES } from './features';
import { SEO_PAGES, seoPageFor } from './seo';

/** The category hubs: pages of the shell, owned by no single feature. */
const HUB_PAGES = ['/', '/ollivanders', '/diagon-alley'];

function ownerOf(path: string) {
  return FEATURES.find((feature) =>
    feature.roots.some((root) => path === root || path.startsWith(`${root}/`)),
  );
}

describe('the public pages', () => {
  it('are only pages the standalone site ships', () => {
    for (const { path } of SEO_PAGES) {
      if (HUB_PAGES.includes(path)) continue;
      const owner = ownerOf(path);
      expect(owner, path).toBeDefined();
      expect(owner?.needsHub, path).toBe(false);
    }
  });

  it('include every standalone feature that has a page of its own', () => {
    for (const feature of STANDALONE_FEATURES) {
      const [root] = feature.roots;
      if (!root || feature.id === 'toolbox') continue;
      expect(seoPageFor(root), feature.id).toBeDefined();
    }
  });

  it('each have a distinct title and description of a length search results show whole', () => {
    expect(new Set(SEO_PAGES.map((page) => page.path)).size).toBe(SEO_PAGES.length);
    expect(new Set(SEO_PAGES.map((page) => page.title)).size).toBe(SEO_PAGES.length);
    expect(new Set(SEO_PAGES.map((page) => page.description)).size).toBe(SEO_PAGES.length);
    for (const page of SEO_PAGES) {
      expect(page.title.length, page.path).toBeLessThanOrEqual(65);
      expect(page.description.length, page.path).toBeGreaterThanOrEqual(50);
      expect(page.description.length, page.path).toBeLessThanOrEqual(170);
    }
  });

  it('are found with or without a trailing slash, and nothing else is', () => {
    expect(seoPageFor('/runestone/')?.path).toBe('/runestone');
    expect(seoPageFor('/')?.path).toBe('/');
    expect(seoPageFor('/runestone/a-saved-slug')).toBeUndefined();
    expect(seoPageFor('/hermes')).toBeUndefined();
  });
});
