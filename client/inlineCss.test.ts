import { describe, expect, it, vi } from 'vitest';
import { filesNaming, inlineCssPlugin, inlineStylesheets, type InlineBundle } from './inlineCss';

/** The head Vite writes: the entry script, its modulepreloads, the stylesheet, the font preloads. */
const HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Bifrost</title>
    <script type="module" crossorigin src="/assets/index-a1.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-dom-b2.js">
    <link rel="stylesheet" crossorigin href="/assets/index-c3.css">
    <link rel="preload" href="/assets/inter-d4.woff2" as="font" type="font/woff2" crossorigin="">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
const CSS = ':root{--bg:#000}.shell{display:grid}@font-face{src:url(/assets/inter-d4.woff2)}';

describe('the shell stylesheet, inline (PLAN-41)', () => {
  it('replaces the link with a <style> holding the same CSS, last in <head>', () => {
    const { html, inlined } = inlineStylesheets(HTML, { 'assets/index-c3.css': CSS });

    expect(inlined).toEqual(['assets/index-c3.css']);
    expect(html).not.toMatch(/rel="stylesheet"/);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).toContain(`<style>${CSS}</style>`);
    // After the script, the modulepreload and the font preload: the preload
    // scanner meets every URL before the CSS bytes.
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head.lastIndexOf('<style>')).toBeGreaterThan(head.indexOf('rel="preload"'));
    expect(head.lastIndexOf('<style>')).toBeGreaterThan(head.indexOf('type="module"'));
    expect(html.indexOf('</style>')).toBeLessThan(html.indexOf('</head>'));
    // Nothing else moved.
    expect(html.replace(/\s*<style>[^<]*<\/style>/, '')).toBe(
      HTML.replace(/[ \t]*<link rel="stylesheet"[^>]*>\n/, ''),
    );
  });

  it('leaves HTML with no stylesheet as it is', () => {
    const plain = HTML.replace(/[ \t]*<link rel="stylesheet"[^>]*>\n/, '');
    expect(inlineStylesheets(plain, {})).toEqual({ html: plain, inlined: [] });
  });

  it('fails when the linked stylesheet is not in the build, naming it', () => {
    expect(() => inlineStylesheets(HTML, {})).toThrow(/links \/assets\/index-c3\.css/);
  });

  it('fails on CSS that would end the element early', () => {
    const hostile = '.x::after{content:"</style><script>"}';
    expect(() => inlineStylesheets(HTML, { 'assets/index-c3.css': hostile })).toThrow(
      /index-c3\.css contains "<\/style"/,
    );
  });

  it('fails on a relative base, whose url()s would resolve against each page', () => {
    expect(() => inlineStylesheets(HTML, { 'assets/index-c3.css': CSS }, './')).toThrow(
      /base "\.\/" is relative/,
    );
  });

  it('finds an emitted file that still names the inlined stylesheet, but not the HTML pages', () => {
    const bundle: InlineBundle = {
      'index.html': { type: 'asset', fileName: 'index.html', source: '<style>…</style>' },
      'edda/index.html': {
        type: 'asset',
        fileName: 'edda/index.html',
        source: '<link href="/assets/index-c3.css">',
      },
      'assets/index-a1.js': { type: 'chunk', fileName: 'assets/index-a1.js', code: 'run()' },
      'assets/Page-e5.js': {
        type: 'chunk',
        fileName: 'assets/Page-e5.js',
        code: 'preload(["assets/index-c3.css"])',
      },
    };
    expect(filesNaming(bundle, ['assets/index-c3.css'])).toEqual(['assets/Page-e5.js']);
    expect(filesNaming(bundle, ['assets/other.css'])).toEqual([]);
  });
});

describe('the inline CSS plugin', () => {
  type Hook = (this: unknown, ...args: unknown[]) => unknown;

  function run(bundleExtra: InlineBundle = {}) {
    const plugin = inlineCssPlugin();
    const css = { type: 'asset', fileName: 'assets/index-c3.css', source: CSS } as const;
    const bundle: InlineBundle = { 'assets/index-c3.css': css, ...bundleExtra };
    (plugin.configResolved as Hook).call({}, { base: '/' });
    const transform = plugin.transformIndexHtml as { handler: Hook };
    const html = transform.handler.call({}, HTML, { bundle }) as string;
    const ctx = {
      error: vi.fn((message: string) => {
        throw new Error(message);
      }),
      info: vi.fn(),
    };
    const generate = () => (plugin.generateBundle as Hook).call(ctx, {}, bundle);
    return { html, bundle, ctx, generate };
  }

  it('inlines the stylesheet, then drops the file from the build', () => {
    const { html, bundle, ctx, generate } = run();
    expect(html).toContain(`<style>${CSS}</style>`);
    generate();
    expect(bundle['assets/index-c3.css']).toBeUndefined();
    expect(ctx.info).toHaveBeenCalledWith(expect.stringMatching(/KB of shell styles inline/));
  });

  it('fails the build when a chunk would still load the dropped file', () => {
    const { bundle, generate } = run({
      'assets/Page-e5.js': {
        type: 'chunk',
        fileName: 'assets/Page-e5.js',
        code: 'preload(["assets/index-c3.css"])',
      },
    });
    expect(generate).toThrow(/assets\/Page-e5\.js still name assets\/index-c3\.css/);
    expect(bundle['assets/index-c3.css']).toBeDefined();
  });

  it('does nothing on the dev server, which has no bundle', () => {
    const plugin = inlineCssPlugin();
    const transform = plugin.transformIndexHtml as { handler: Hook };
    expect(transform.handler.call({}, HTML, {})).toBeUndefined();
  });
});
