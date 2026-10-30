/**
 * The shell's stylesheet, inline in every HTML file either build ships
 * (PLAN-41).
 *
 * Since each page's and panel's styles load with that page's chunk, what is
 * left in the entry stylesheet is the shell's: about 9 KB gzipped. As a
 * `<link>` it was the page's only render-blocking request, and the head of the
 * longest request chain (HTML → stylesheet → the fonts it names). Inline, the
 * first render needs nothing but the HTML to be styled.
 *
 * The `<style>` goes last in `<head>`, after the module script, the
 * modulepreloads and the font preloads, so the browser's preload scanner meets
 * every URL before the CSS bytes. A lazy page's stylesheet is appended to
 * `<head>` later, so the shell's rules still come first, as they did with the
 * link. The links are replaced in `transformIndexHtml`, from the CSS assets in
 * the bundle; the standalone SEO plugin writes its pages from that same
 * `index.html` afterwards, so every prerendered page and `404.html` carry it.
 *
 * The CSS file itself is then dropped from the build, after the bundle budget
 * has counted it: nothing should load it, and a chunk that did would apply the
 * shell's rules again after the page stylesheets and change their cascade.
 * Vite would list it, though: a lazy chunk that imports a module living in the
 * entry chunk (the Markdown stack's, Mermaid's) gets the entry's stylesheet in
 * its preload list, from the entry's `viteMetadata.importedCss`. With the
 * stylesheet a `<link>` the preload helper skipped it as already loaded; inline,
 * it would fetch it, get a 404 and fail the import. So the file leaves every
 * chunk's `importedCss` before Vite writes those lists (its import analysis
 * runs after this plugin's `generateBundle`; `resolveDependencies` can't help,
 * as it is never shown CSS), and the written output is checked: a file that
 * still names it fails the build.
 */
import type { Plugin } from 'vite';

/** A `<link rel="stylesheet">` in the built HTML, with the whitespace before it. */
const STYLESHEET_LINK = /[ \t]*<link\b[^>]*\brel="stylesheet"[^>]*>\n?/g;

/** The asset a link's `href` names, relative to the build's output directory. */
function assetFor(link: string, base: string): string {
  const href = /\bhref="([^"]+)"/.exec(link)?.[1];
  if (!href?.startsWith(base)) {
    throw new Error(`inline css: cannot read the stylesheet link ${link.trim()}`);
  }
  return href.slice(base.length);
}

/**
 * `html` with every stylesheet link removed and their CSS, in order, in one
 * `<style>` last in `<head>`, plus the asset names that were inlined. Throws
 * on a link whose asset isn't in the build, on CSS that would end the element
 * early, and on a relative `base`: the CSS's `url()`s are written for
 * `/assets/`, and inline they would resolve against each page's own path.
 */
export function inlineStylesheets(
  html: string,
  assets: Readonly<Record<string, string>>,
  base = '/',
): { html: string; inlined: string[] } {
  if (!base.startsWith('/')) {
    throw new Error(
      `inline css: base "${base}" is relative; the stylesheet's url()s would break inline`,
    );
  }
  const inlined: string[] = [];
  const sheets: string[] = [];
  const stripped = html.replace(STYLESHEET_LINK, (link) => {
    const file = assetFor(link, base);
    const css = assets[file];
    if (css === undefined) {
      throw new Error(`inline css: index.html links /${file}, which is not in the build`);
    }
    if (/<\/style/i.test(css)) {
      throw new Error(`inline css: ${file} contains "</style", which would end the element`);
    }
    inlined.push(file);
    sheets.push(css.trim());
    return '';
  });
  if (sheets.length === 0) return { html, inlined };
  const heads = stripped.split('</head>').length - 1;
  if (heads !== 1) {
    throw new Error(`inline css: expected one </head> in index.html, found ${heads}`);
  }
  return {
    html: stripped.replace('</head>', () => `  <style>${sheets.join('\n')}</style>\n  </head>`),
    inlined,
  };
}

/** The parts of Vite's output this reads. */
export type InlineBundle = Record<
  string,
  | {
      type: 'chunk';
      fileName: string;
      code: string;
      viteMetadata?: { importedCss: Set<string> };
    }
  | { type: 'asset'; fileName: string; source: string | Uint8Array }
>;

/** Every emitted file, other than an HTML page, that names one of `files`. */
export function filesNaming(bundle: InlineBundle, files: readonly string[]): string[] {
  const names = files.map((file) => file.slice(file.lastIndexOf('/') + 1));
  return Object.values(bundle)
    .filter((output) => !output.fileName.endsWith('.html'))
    .filter((output) => {
      const text = output.type === 'chunk' ? output.code : String(output.source);
      return names.some((name) => text.includes(name));
    })
    .map((output) => output.fileName);
}

export function inlineCssPlugin(): Plugin {
  let base = '/';
  const inlined = new Set<string>();
  return {
    name: 'bifrost-inline-css',
    apply: 'build',
    // After the bundle budget, which counts the stylesheet before it is dropped.
    enforce: 'post',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        // Only a build has the CSS as an asset; the dev server injects it from JS.
        if (!context.bundle) return undefined;
        const assets: Record<string, string> = {};
        for (const output of Object.values(context.bundle)) {
          if (output.type === 'asset' && output.fileName.endsWith('.css')) {
            assets[output.fileName] = String(output.source);
          }
        }
        const result = inlineStylesheets(html, assets, base);
        for (const file of result.inlined) inlined.add(file);
        return result.html;
      },
    },
    generateBundle(_options, bundle) {
      const outputs = bundle as unknown as InlineBundle;
      let bytes = 0;
      for (const file of inlined) {
        const output = outputs[file];
        if (output?.type === 'asset') bytes += String(output.source).length;
        delete outputs[file];
        // Out of every preload list Vite is about to write (see the top of the file).
        for (const chunk of Object.values(outputs)) {
          if (chunk.type === 'chunk') chunk.viteMetadata?.importedCss.delete(file);
        }
      }
      if (inlined.size > 0) {
        this.info(`inline css: ${(bytes / 1024).toFixed(1)} KB of shell styles inline in the HTML`);
      }
    },
    writeBundle(_options, bundle) {
      const files = [...inlined];
      const naming = filesNaming(bundle as unknown as InlineBundle, files);
      if (naming.length > 0) {
        this.error(
          `inline css: ${naming.join(', ')} still name ${files.join(', ')}, which is inlined ` +
            'into the HTML and not emitted: a lazy import would fetch a missing file, or ' +
            're-apply the shell after the page stylesheets',
        );
      }
    },
  };
}
