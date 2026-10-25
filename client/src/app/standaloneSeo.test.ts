// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { SEO_PAGES } from '../core/seo';
import { applyStandaloneSeo } from './standaloneSeo';

const edda = SEO_PAGES.find((page) => page.path === '/edda');

describe('applyStandaloneSeo', () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<title>Bifrost — home</title>' +
      '<meta name="description" content="home" />' +
      '<link rel="canonical" href="https://tools.example.com/" />';
  });

  it('names the page it moved to', () => {
    applyStandaloneSeo('/edda/');
    expect(document.title).toBe(edda?.title);
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      edda?.description,
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://tools.example.com/edda',
    );
  });

  it('falls back to the site name on a page that is not public', () => {
    applyStandaloneSeo('/hermes');
    expect(document.title).toBe('Bifrost');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'home',
    );
  });
});
