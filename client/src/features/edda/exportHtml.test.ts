// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMermaidCache } from '../../core/markdown';
import { exportHtmlDocument } from './exportHtml';

const render = vi.fn();
const initialize = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: (...a: unknown[]) => initialize(...a),
    render: (...a: unknown[]) => render(...a),
  },
}));

const FENCE = '```mermaid\ngraph TD\n  A-->B\n```';

describe('exportHtmlDocument', () => {
  beforeEach(() => {
    clearMermaidCache();
    render.mockReset();
    initialize.mockReset();
    let seq = 0;
    render.mockImplementation(() => {
      seq += 1;
      return Promise.resolve({ svg: `<svg id="s${seq}"><rect width="10" height="10"/></svg>` });
    });
  });

  it('inlines the rendered SVG and leaves no placeholder behind', async () => {
    const html = await exportHtmlDocument('Bridge notes', `# Notes\n\n${FENCE}`);
    expect(html).toContain('<svg');
    expect(html).not.toContain('class="mermaid-src"');
    expect(html).toContain('<title>Bridge notes</title>');
  });

  it('emits a screen copy and a print copy of every diagram', async () => {
    const html = await exportHtmlDocument('D', FENCE);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('figure.mermaid--screen')).toHaveLength(1);
    expect(doc.querySelectorAll('figure.mermaid--print')).toHaveLength(1);
    // Drawn twice on purpose: mermaid bakes colour into the SVG, so one copy
    // cannot be both theme-correct on screen and ink-on-paper in print.
    expect(render).toHaveBeenCalledTimes(2);
    const [screen, print] = Array.from(doc.querySelectorAll('figure.mermaid'));
    expect(screen?.getAttribute('data-mermaid-palette')).not.toBe(
      print?.getAttribute('data-mermaid-palette'),
    );
    // The print twin is hidden on screen and swapped in by the print block.
    expect(html).toContain('figure.mermaid--print { display: none; }');
    expect(html).toContain('figure.mermaid--screen { display: none; }');
  });

  it('carries a print block that forces ink on paper and protects page breaks', async () => {
    const html = await exportHtmlDocument('D', '# Hi\n\ntext');
    expect(html).toContain('@media print');
    expect(html).toContain('--text: #16181d;');
    expect(html).toContain('background: #ffffff');
    expect(html).toContain('break-inside: avoid;');
    expect(html).toContain('break-after: avoid;');
  });

  it('turns a `<!-- pagebreak -->` line into a forced break', async () => {
    const html = await exportHtmlDocument('D', 'before\n\n<!-- pagebreak -->\n\nafter');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('main .pagebreak')).toHaveLength(1);
    expect(html).toContain('.pagebreak { break-after: page; }');
  });

  it('leaves a pagebreak comment inside prose alone', async () => {
    const html = await exportHtmlDocument('D', 'text with <!-- pagebreak --> inline');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('main .pagebreak')).toHaveLength(0);
  });

  it('never loads mermaid for a document with no diagram', async () => {
    await exportHtmlDocument('D', '# Plain\n\n```js\nconst x = 1;\n```');
    expect(initialize).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('escapes the title', async () => {
    const html = await exportHtmlDocument('<script>x</script>', 'body');
    expect(html).toContain('<title>&lt;script&gt;x&lt;/script&gt;</title>');
  });
});
