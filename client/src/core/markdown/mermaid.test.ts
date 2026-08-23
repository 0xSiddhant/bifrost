// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMermaidCache, renderMermaidIn, PAPER_PALETTE } from './mermaid';
import { renderMarkdown } from './render';

const render = vi.fn();
const initialize = vi.fn();

vi.mock('mermaid', () => ({ default: { initialize: (...a: unknown[]) => initialize(...a), render: (...a: unknown[]) => render(...a) } }));

/** A stand-in for what mermaid actually returns: SVG carrying its own <style>. */
function fakeSvg(label: string): string {
  return `<svg id="d" role="graphics-document"><style>#d .node{fill:#123456}</style><g class="node"><text>${label}</text></g></svg>`;
}

function container(markdown: string): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(markdown);
  document.body.append(div);
  return div;
}

const FENCE = '```mermaid\ngraph TD\n  A-->B\n```';

describe('renderMermaidIn', () => {
  beforeEach(() => {
    clearMermaidCache();
    render.mockReset();
    initialize.mockReset();
    render.mockImplementation((_id: string, source: string) =>
      Promise.resolve({ svg: fakeSvg(source.slice(0, 8)) }),
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  it('replaces the placeholder with a figure holding the rendered SVG', async () => {
    const div = container(`Intro\n\n${FENCE}`);
    expect(div.querySelectorAll('pre.mermaid-src')).toHaveLength(1);

    const drawn = await renderMermaidIn(div);

    expect(drawn).toBe(1);
    expect(div.querySelectorAll('pre.mermaid-src')).toHaveLength(0);
    const figure = div.querySelector('figure.mermaid');
    expect(figure).not.toBeNull();
    expect(figure?.querySelector('svg')).not.toBeNull();
    // The spike's finding, pinned: DOMPurify's SVG profile keeps a <style>
    // inside the <svg>, which is where every diagram's colour lives.
    expect(figure?.querySelector('style')?.textContent).toContain('fill:#123456');
    expect(figure?.getAttribute('data-mermaid-src')).toBe('graph TD\n  A-->B');
  });

  it('never imports mermaid for a document with no diagram', async () => {
    const div = container('# Just prose\n\n```js\nconst x = 1;\n```');
    expect(await renderMermaidIn(div)).toBe(0);
    expect(initialize).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('pins the untrusted-input config, including the styling keys mermaid leaves open', async () => {
    await renderMermaidIn(container(FENCE));
    const config = initialize.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.securityLevel).toBe('strict');
    expect(config.htmlLabels).toBe(false);
    expect(config.suppressErrorRendering).toBe(true);
    // mermaid's default `secure` list does NOT cover themeCSS, so a diagram
    // could otherwise put raw CSS — including a url() that hits the network —
    // into the <style> the sanitizer keeps. Reproduced during the spike.
    expect(config.secure).toContain('themeCSS');
    expect(config.secure).toContain('securityLevel');
    expect(config.secure).toContain('fontFamily');
  });

  it('reuses an unchanged diagram and re-renders a changed one', async () => {
    await renderMermaidIn(container(FENCE));
    expect(render).toHaveBeenCalledTimes(1);

    // Same source again, fresh container (what a re-render of the preview does).
    await renderMermaidIn(container(FENCE));
    expect(render).toHaveBeenCalledTimes(1);

    await renderMermaidIn(container('```mermaid\ngraph LR\n  C-->D\n```'));
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('redraws when the theme changes under an already-rendered diagram', async () => {
    const div = container(FENCE);
    await renderMermaidIn(div);
    expect(render).toHaveBeenCalledTimes(1);
    const first = div.querySelector('figure.mermaid')?.getAttribute('data-mermaid-palette');

    // A figure, not a placeholder, is what the theme switch finds.
    expect(div.querySelector('pre.mermaid-src')).toBeNull();
    document.documentElement.style.setProperty('--accent', '#ff0000');

    expect(await renderMermaidIn(div)).toBe(1);
    expect(render).toHaveBeenCalledTimes(2);
    expect(div.querySelector('figure.mermaid')?.getAttribute('data-mermaid-palette')).not.toBe(
      first,
    );
  });

  it('leaves an already-current diagram alone', async () => {
    const div = container(FENCE);
    await renderMermaidIn(div);
    expect(await renderMermaidIn(div)).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('draws the same source twice when the palette is overridden (the export path)', async () => {
    await renderMermaidIn(container(FENCE));
    await renderMermaidIn(container(FENCE), { palette: PAPER_PALETTE });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('turns a failing diagram into a bordered error block, not an exception', async () => {
    render.mockRejectedValueOnce(new Error('Parse error on line 2:\n  ...detail'));
    const div = container(FENCE);

    await expect(renderMermaidIn(div)).resolves.toBe(1);

    const figure = div.querySelector('figure.mermaid--error');
    // Named, and the trailing colon is trimmed — what follows it in mermaid's
    // message is the source excerpt, which the block already shows below.
    expect(figure?.querySelector('figcaption')?.textContent).toBe(
      'This diagram could not be drawn — Parse error on line 2',
    );
    expect(figure?.querySelector('pre')?.textContent).toBe('graph TD\n  A-->B');
    expect(div.querySelector('svg')).toBeNull();
  });

  it('degrades to readable source when the chunk itself cannot be loaded', async () => {
    initialize.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    const div = container(FENCE);
    expect(await renderMermaidIn(div)).toBe(0);
    expect(div.querySelector('pre.mermaid-src')?.textContent).toBe('graph TD\n  A-->B');
  });
});
