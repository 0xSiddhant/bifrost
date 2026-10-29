import { describe, expect, it } from 'vitest';
import { fontPreloadTags, PRELOADED_FONTS, preloadedFontFiles } from './fontPreload';

/** What a build emits beside the fonts: every weight, plus look-alikes. */
const BUILD = [
  'assets/index-a1.js',
  'assets/index-b2.css',
  'assets/space-grotesk-v22-latin-500-lFbtlQH6.woff2',
  'assets/space-grotesk-v22-latin-700-RjhwGPKo.woff2',
  'assets/inter-v20-latin-500-Cerq10X2.woff2',
  'assets/inter-v20-latin-regular-C38fXH4l.woff2',
  'assets/jetbrains-mono-v24-latin-regular-V6pRDFza.woff2',
];

describe('the first-paint font preload (PLAN-40)', () => {
  it('finds exactly Space Grotesk 700 and Inter 400 among the hashed fonts', () => {
    expect(preloadedFontFiles(BUILD)).toEqual([
      'assets/space-grotesk-v22-latin-700-RjhwGPKo.woff2',
      'assets/inter-v20-latin-regular-C38fXH4l.woff2',
    ]);
  });

  it('gives exactly two preload links, each with crossorigin', () => {
    const tags = fontPreloadTags(preloadedFontFiles(BUILD));
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(tag.tag).toBe('link');
      expect(tag.attrs).toMatchObject({ rel: 'preload', as: 'font', type: 'font/woff2' });
      expect(tag.attrs).toHaveProperty('crossorigin');
      expect(tag.injectTo).toBe('head');
    }
    expect(tags.map((tag) => tag.attrs?.href)).toEqual([
      '/assets/space-grotesk-v22-latin-700-RjhwGPKo.woff2',
      '/assets/inter-v20-latin-regular-C38fXH4l.woff2',
    ]);
  });

  it('fails the build when a first-paint font is missing, naming it', () => {
    const renamed = BUILD.filter((name) => !name.includes('inter-v20-latin-regular'));
    expect(() => preloadedFontFiles(renamed)).toThrow(/no inter-v20-latin-regular\.woff2/);
    // Another weight of the same family does not stand in for it.
    expect(renamed.some((name) => name.includes('inter-v20'))).toBe(true);
  });

  it('names the fonts core/fonts.css declares', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('./src/core/fonts.css', import.meta.url), 'utf8');
    for (const font of PRELOADED_FONTS) expect(css).toContain(`/${font}.woff2`);
  });
});
