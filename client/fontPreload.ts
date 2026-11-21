/**
 * A preload for the two web fonts the first paint uses (PLAN-40), in every
 * HTML file either build ships.
 *
 * The browser finds a font only once the stylesheet that names it has
 * arrived, so a font that lands after the first paint swaps in and shifts the
 * text (the public site's 0.017 layout shift, all of it these two). A
 * `<link rel="preload">` in the head starts them with the CSS instead. Only
 * these two: Inter 500 and JetBrains Mono 400 are in React's first render of
 * the home page too, but they are requested once it has rendered, swap in with
 * no shift, and preloading them would put 45 KB ahead of the entry chunk the
 * first render waits for (measured in PLAN-41). The other weights aren't on
 * the home page. `font-display: swap` stays, so text never waits on a slow font.
 *
 * The file names are hashed, so they exist only in the build: the links are
 * added in `transformIndexHtml` from the bundle's own asset names. The
 * standalone SEO plugin writes its pages from that same `index.html`
 * afterwards, so every prerendered page and `404.html` inherit them.
 */
import type { HtmlTagDescriptor, Plugin } from 'vite';

/** The fonts' source names (`core/fonts.css`), without the build's hash. */
export const PRELOADED_FONTS = [
  // Space Grotesk 700: headings.
  'space-grotesk-v22-latin-700',
  // Inter 400: body text.
  'inter-v20-latin-regular',
] as const;

/**
 * The emitted file for each font, from the bundle's file names
 * (`assets/inter-v20-latin-regular-C38fXH4l.woff2`). Throws, naming each
 * missing one, so renaming or replacing a font cannot silently drop its
 * preload.
 */
export function preloadedFontFiles(
  fileNames: readonly string[],
  fonts: readonly string[] = PRELOADED_FONTS,
): string[] {
  const missing: string[] = [];
  const found = fonts.map((font) => {
    const pattern = new RegExp(
      `(^|/)${font.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[\\w-]+\\.woff2$`,
    );
    const file = fileNames.find((name) => pattern.test(name));
    if (!file) missing.push(font);
    return file ?? '';
  });
  if (missing.length > 0) {
    throw new Error(
      `font preload: no ${missing.join(', ')}.woff2 in the build. A first-paint font was ` +
        'renamed or removed: update PRELOADED_FONTS in client/fontPreload.ts to match core/fonts.css',
    );
  }
  return found;
}

/** One preload tag per font. `crossorigin` is required: fonts are fetched in CORS mode. */
export function fontPreloadTags(files: readonly string[], base = '/'): HtmlTagDescriptor[] {
  return files.map((file) => ({
    tag: 'link',
    attrs: {
      rel: 'preload',
      href: `${base}${file}`,
      as: 'font',
      type: 'font/woff2',
      crossorigin: '',
    },
    injectTo: 'head',
  }));
}

export function fontPreloadPlugin(): Plugin {
  let base = '/';
  return {
    name: 'bifrost-font-preload',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        // Only a build has hashed names; the dev server serves fonts from source.
        if (!context.bundle) return undefined;
        return fontPreloadTags(preloadedFontFiles(Object.keys(context.bundle)), base);
      },
    },
  };
}
