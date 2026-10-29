import { describe, expect, it } from 'vitest';
import { SEO_PAGES } from './src/core/seo';
import { resolveThemeChoice } from './src/core/theme';
import { BUILT_IN_DEFAULT_THEME } from './src/core/theme/builtInDefault';
import { BUNDLED_THEMES } from './src/core/theme/bundled';
import {
  firstPaintStyle,
  firstVisitTheme,
  pageFile,
  readBundledThemes,
  readSiteUrl,
  renderNotFound,
  renderPage,
  renderRobots,
  renderSitemap,
  seoFiles,
} from './seoBuild';

const SHELL = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <title>Bifrost</title>',
  '    <script type="module" crossorigin src="/assets/index-abc.js"></script>',
  '  </head>',
  '  <body>',
  '    <div id="root"></div>',
  '  </body>',
  '</html>',
].join('\n');

const SITE = 'https://tools.example.com';

function page(path: string) {
  const found = SEO_PAGES.find((p) => p.path === path);
  if (!found) throw new Error(path);
  return found;
}

describe('readSiteUrl', () => {
  it('reads an origin, and nothing when unset', () => {
    expect(readSiteUrl({ STANDALONE_SITE_URL: 'https://tools.example.com/' })).toBe(SITE);
    expect(readSiteUrl({ STANDALONE_SITE_URL: '  ' })).toBeNull();
    expect(readSiteUrl({})).toBeNull();
  });

  it('refuses anything a canonical link cannot be built from', () => {
    for (const bad of [
      'tools.example.com',
      'ftp://x.example',
      'https://x.example/sub',
      'https://x.example/?a=1',
    ]) {
      expect(() => readSiteUrl({ STANDALONE_SITE_URL: bad }), bad).toThrow(/STANDALONE_SITE_URL/);
    }
  });
});

describe('renderPage', () => {
  const html = renderPage(SHELL, page('/runestone'), SITE);

  it('names the page in its title, description and preview tags', () => {
    expect(html).toContain(`<title>${page('/runestone').title}</title>`);
    expect(html).not.toContain('<title>Bifrost</title>');
    expect(html).toContain('<meta name="description" content="Validate, format');
    expect(html).toContain(
      '<meta property="og:title" content="JSON editor, formatter and validator',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  it('points canonical, og:url and og:image at the public origin', () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/runestone" />`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}/runestone" />`);
    expect(html).toContain(`<meta property="og:image" content="${SITE}/pwa-512x512.png" />`);
  });

  it('carries structured data a parser can read', () => {
    const json = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(JSON.parse(json)).toMatchObject({
      '@type': 'WebApplication',
      url: `${SITE}/runestone`,
      offers: { price: '0' },
    });
    const home = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(
      renderPage(SHELL, page('/'), SITE),
    )?.[1];
    expect(JSON.parse(home ?? '')).toMatchObject({ '@type': 'WebSite', url: `${SITE}/` });
  });

  it('puts a heading, the description and links to every other page inside #root', () => {
    const root = /<div id="root">(.*)<\/div>/.exec(html)?.[1] ?? '';
    expect(root).toContain(`<h1>${page('/runestone').heading}</h1>`);
    expect(root).toContain('<a href="/variant">');
    expect(root).toContain('<a href="/diagon-alley/jwt">');
    expect(root).not.toContain('<a href="/runestone">');
  });

  it('keeps the build’s own script and leaves out what needs a site URL when there is none', () => {
    const bare = renderPage(SHELL, page('/runestone'), null);
    expect(bare).toContain('src="/assets/index-abc.js"');
    expect(bare).not.toMatch(/canonical|og:url|og:image/);
    expect(bare).toContain('<meta name="description"');
  });

  it('escapes text, and fails loudly on a shell it does not recognise', () => {
    const odd = {
      path: '/x',
      title: 'A <b> & "c"',
      description: 'd'.repeat(60),
      heading: '</script>',
    };
    const out = renderPage(SHELL, odd, SITE);
    expect(out).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(out).not.toContain('<h1></script>');
    expect(() => renderPage('<html></html>', odd, SITE)).toThrow(/<title>/);
  });
});

describe('the other files', () => {
  it('404.html asks not to be indexed and has no canonical', () => {
    const html = renderNotFound(SHELL);
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).not.toContain('canonical');
  });

  it('robots.txt allows everything and names the sitemap when it can', () => {
    expect(renderRobots(SITE)).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
    expect(renderRobots(null)).toBe('User-agent: *\nAllow: /\n');
  });

  it('the sitemap lists every public page, absolute', () => {
    const xml = renderSitemap(SITE);
    expect(xml.match(/<loc>/g)).toHaveLength(SEO_PAGES.length);
    expect(xml).toContain(`<loc>${SITE}/</loc>`);
    expect(xml).toContain(`<loc>${SITE}/diagon-alley/base64</loc>`);
  });

  it('a page per public path, plus 404, robots and sitemap', () => {
    const files = seoFiles(SHELL, SITE);
    expect(files.size).toBe(SEO_PAGES.length + 3);
    expect(pageFile('/')).toBe('index.html');
    expect(pageFile('/diagon-alley/qr')).toBe('diagon-alley/qr/index.html');
    expect(files.get('index.html')).toContain(`<title>${page('/').title}</title>`);
    expect(seoFiles(SHELL, null).has('sitemap.xml')).toBe(false);
  });
});

describe('the first-visit theme', () => {
  const themes = readBundledThemes();

  it('reads the same themes, in the same order, as the bundle', () => {
    expect(themes.map((theme) => theme.id)).toEqual(BUNDLED_THEMES.map((theme) => theme.id));
  });

  it('is the one the theme engine settles on for a first visit, in either colour scheme', () => {
    for (const builtInId of [BUILT_IN_DEFAULT_THEME, null]) {
      for (const prefersLight of [true, false]) {
        const runtime = resolveThemeChoice({
          stored: null,
          defaultId: null,
          builtInId,
          themes,
          prefersLight,
        });
        expect(firstVisitTheme(themes, prefersLight ? 'light' : 'dark', builtInId)?.id).toBe(
          runtime,
        );
      }
    }
  });

  it('paints the built-in default from the first frame, one rule for both schemes', () => {
    const style = firstPaintStyle(themes);
    const theme = themes.find((candidate) => candidate.id === BUILT_IN_DEFAULT_THEME);
    expect(theme).toBeDefined();
    expect(style).toMatch(new RegExp(`^<style>html:root\\{color-scheme:${theme?.mode};`));
    expect(style).toContain(`--bg:${theme?.tokens['--bg']}`);
    expect(style).not.toContain('@media');
  });

  it('without a built-in default, paints dark by default and light where the device prefers it', () => {
    const style = firstPaintStyle(themes, null);
    const dark = firstVisitTheme(themes, 'dark', null);
    const light = firstVisitTheme(themes, 'light', null);
    expect(style).toMatch(/^<style>html:root\{color-scheme:dark;/);
    expect(style).toContain(`--bg:${dark?.tokens['--bg']}`);
    expect(style).toContain(`@media (prefers-color-scheme: light){html:root{color-scheme:light;`);
    expect(style).toContain(`--bg:${light?.tokens['--bg']}`);
  });

  it('is in every page and the 404, after the title', () => {
    const files = seoFiles(SHELL, SITE, themes);
    for (const [name, html] of files) {
      if (!name.endsWith('.html')) continue;
      expect(html, name).toMatch(/<\/title>[\s\S]*<style>html:root\{/);
    }
  });

  it('refuses a token value that could break out of the rule', () => {
    const [first] = themes;
    if (!first) throw new Error('no themes');
    const bad = { ...first, tokens: { ...first.tokens, '--bg': 'red}</style><script>' } };
    expect(() => firstPaintStyle([bad])).toThrow(/unsafe --bg/);
  });
});
