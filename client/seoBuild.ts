/**
 * The standalone site's search-engine files, written at build time: a real
 * HTML file per public page (its own title, description, canonical link,
 * preview tags, structured data and a short visible summary with links),
 * plus `404.html`, `robots.txt` and `sitemap.xml`. The site stays static
 * files and nothing else; nginx serves `<path>/index.html` for each page and
 * `404.html`, with a 404 status, for everything that is not one
 * (docker/nginx-standalone.conf).
 *
 * The summary sits inside `#root`, so a crawler reads it as the page, and
 * React's first render replaces it. Every file also paints the theme a first
 * visit gets from its first frame (`firstPaintStyle`). Runs in Node, from
 * `vite.config.ts`, for the standalone build only: the hub is a LAN app and
 * stays unindexed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { SEO_PAGES, SITE_NAME, type SeoPage } from './src/core/seo';
import {
  resolveTheme,
  type ResolvedTheme,
  type ThemeFile,
  type ThemeMode,
} from './src/core/theme/resolve';

export const SITE_URL_KEY = 'STANDALONE_SITE_URL';

/** The preview image: the 512px app icon, so `twitter:card` is `summary`. */
const OG_IMAGE = { path: '/pwa-512x512.png', size: 512 };

/**
 * The public origin the site is served from (`https://tools.example.com`),
 * or null when unset. Canonical links, `og:url` and the sitemap need it
 * absolute; without it they are left out and the build warns. A malformed
 * value fails the build, as `readBuildDefaults` does for its keys.
 */
export function readSiteUrl(env: Record<string, string | undefined>): string | null {
  const raw = env[SITE_URL_KEY]?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${SITE_URL_KEY}=${raw} must be an absolute URL, e.g. https://tools.example.com`,
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${SITE_URL_KEY}=${raw} must start with https:// or http://`);
  }
  // The build's asset paths are absolute (/assets/…), so it is served from the root.
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${SITE_URL_KEY}=${raw} must be an origin only, with no path, query or hash`);
  }
  return url.origin;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The bundled themes as `core/theme/bundled.ts` has them: resolved, sorted by name. */
export function readBundledThemes(
  dir = new URL('./src/assets/themes/', import.meta.url),
): ResolvedTheme[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => resolveTheme(JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as ThemeFile))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The theme a first visit to the standalone site settles on. With no stored
 * choice and no household default, `resolveThemeChoice` (core/theme) takes
 * the first theme of the device's colour scheme, so the build can know it.
 */
export function firstVisitTheme(
  themes: readonly ResolvedTheme[],
  mode: ThemeMode,
): ResolvedTheme | undefined {
  return themes.find((theme) => theme.mode === mode) ?? themes[0];
}

/**
 * Both first-visit themes' tokens as CSS, picked by `prefers-color-scheme`.
 * Without it the first frame is the stylesheet's dark defaults until the
 * theme engine runs, a dark flash on every light-preferring device's first
 * visit, now with the prerendered summary in it. `html:root` outranks
 * tokens.css's `:root`; a returning visitor's cached theme is set as an
 * inline style by index.html's script, which outranks both.
 */
export function firstPaintStyle(themes: readonly ResolvedTheme[]): string {
  const rule = (theme: ResolvedTheme | undefined): string => {
    if (!theme) return '';
    const declarations = Object.entries(theme.tokens).map(([key, value]) => {
      if (/[<{};]/.test(value)) throw new Error(`seo: theme ${theme.id} has an unsafe ${key}`);
      return `${key}:${value}`;
    });
    return `html:root{color-scheme:${theme.mode};${declarations.join(';')}}`;
  };
  const light = rule(firstVisitTheme(themes, 'light'));
  return (
    `<style>${rule(firstVisitTheme(themes, 'dark'))}` +
    `${light ? `@media (prefers-color-scheme: light){${light}}` : ''}</style>`
  );
}

/** Where a page's file goes in the build: `/` → `index.html`, `/edda` → `edda/index.html`. */
export function pageFile(path: string): string {
  return path === '/' ? 'index.html' : `${path.slice(1)}/index.html`;
}

function replaceOnce(html: string, pattern: RegExp, replacement: string, what: string): string {
  const matches = html.match(new RegExp(pattern.source, 'g')) ?? [];
  if (matches.length !== 1) {
    throw new Error(`seo: expected one ${what} in the built index.html, found ${matches.length}`);
  }
  return html.replace(pattern, () => replacement);
}

/** `<title>` replaced, `head` appended to it, and `body` inside `#root`. */
function fill(shell: string, title: string, head: string[], body: string): string {
  const withTitle = replaceOnce(
    shell,
    /<title>[^<]*<\/title>/,
    [`<title>${escapeHtml(title)}</title>`, ...head].join('\n    '),
    '<title>',
  );
  return replaceOnce(withTitle, /<div id="root"><\/div>/, `<div id="root">${body}</div>`, '#root');
}

function structuredData(page: SeoPage, siteUrl: string | null): string {
  const url = siteUrl ? { url: `${siteUrl}${page.path}` } : {};
  const data =
    page.path === '/'
      ? {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: SITE_NAME,
          description: page.description,
          ...url,
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: page.heading,
          description: page.description,
          ...url,
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'Any',
          browserRequirements: 'Requires JavaScript',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          isPartOf: {
            '@type': 'WebSite',
            name: SITE_NAME,
            ...(siteUrl ? { url: `${siteUrl}/` } : {}),
          },
        };
  // `<` escaped, so no string in the data can close the script element.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** Every public page, linked: what a crawler follows from any one of them. */
function pageLinks(current: string): string {
  const items = SEO_PAGES.filter((page) => page.path !== current).map(
    (page) => `<li><a href="${page.path}">${escapeHtml(page.heading)}</a></li>`,
  );
  return `<nav aria-label="Tools"><ul>${items.join('')}</ul></nav>`;
}

export function renderPage(shell: string, page: SeoPage, siteUrl: string | null): string {
  const canonical = siteUrl ? `${siteUrl}${page.path}` : null;
  const meta = (attr: 'name' | 'property', key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  const head = [
    meta('name', 'description', page.description),
    ...(canonical ? [`<link rel="canonical" href="${escapeHtml(canonical)}" />`] : []),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    ...(canonical ? [meta('property', 'og:url', canonical)] : []),
    ...(siteUrl
      ? [
          meta('property', 'og:image', `${siteUrl}${OG_IMAGE.path}`),
          meta('property', 'og:image:width', String(OG_IMAGE.size)),
          meta('property', 'og:image:height', String(OG_IMAGE.size)),
        ]
      : []),
    meta('name', 'twitter:card', 'summary'),
    meta('name', 'twitter:title', page.title),
    meta('name', 'twitter:description', page.description),
    structuredData(page, siteUrl),
  ];
  const body =
    `<main class="seo-static"><h1>${escapeHtml(page.heading)}</h1>` +
    `<p>${escapeHtml(page.description)}</p>${pageLinks(page.path)}</main>`;
  return fill(shell, page.title, head, body);
}

/** Served with a 404 for every path that is not a page; the app still explains it. */
export function renderNotFound(shell: string): string {
  return fill(
    shell,
    `Page not found | ${SITE_NAME}`,
    ['<meta name="robots" content="noindex" />'],
    '',
  );
}

export function renderRobots(siteUrl: string | null): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (siteUrl) lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

export function renderSitemap(siteUrl: string): string {
  const urls = SEO_PAGES.map(
    (page) => `  <url><loc>${escapeHtml(`${siteUrl}${page.path}`)}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** Every file this writes, by its path in the build; `index.html` replaces the shell. */
export function seoFiles(
  shell: string,
  siteUrl: string | null,
  themes: readonly ResolvedTheme[] = [],
): Map<string, string> {
  const painted = themes.length
    ? replaceOnce(shell, /<\/title>/, `</title>\n    ${firstPaintStyle(themes)}`, '</title>')
    : shell;
  const files = new Map<string, string>();
  for (const page of SEO_PAGES) files.set(pageFile(page.path), renderPage(painted, page, siteUrl));
  files.set('404.html', renderNotFound(painted));
  files.set('robots.txt', renderRobots(siteUrl));
  if (siteUrl) files.set('sitemap.xml', renderSitemap(siteUrl));
  return files;
}

/** The standalone build's plugin: runs after Vite has written the shell into the bundle. */
export function seoPlugin(siteUrl: string | null, themes = readBundledThemes()): Plugin {
  return {
    name: 'bifrost-standalone-seo',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const shell = bundle['index.html'];
      if (!shell || shell.type !== 'asset') {
        this.error('seo: the build has no index.html to write the pages from');
      }
      for (const [fileName, source] of seoFiles(String(shell.source), siteUrl, themes)) {
        if (fileName === 'index.html') shell.source = source;
        else this.emitFile({ type: 'asset', fileName, source });
      }
      if (!siteUrl) {
        this.warn(
          `${SITE_URL_KEY} is not set: built without canonical links, og:url, og:image or sitemap.xml. ` +
            'Set it to the public origin before deploying (docs/standalone.md).',
        );
      }
    },
  };
}
