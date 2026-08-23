// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { clearMermaidCache } from '../../core/markdown';
import { MarkdownViewer } from './viewers';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const render = vi.fn();
const initialize = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: (...a: unknown[]) => initialize(...a),
    render: (...a: unknown[]) => render(...a),
  },
}));

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('MarkdownViewer', () => {
  let container: HTMLDivElement;
  let root: Root;

  const serve = (text: string) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(text) })),
    );
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    clearMermaidCache();
    render.mockReset();
    initialize.mockReset();
    render.mockResolvedValue({ svg: '<svg id="v"><rect width="4" height="4"/></svg>' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders a diagram from a .md file on disk', async () => {
    serve('# Notes\n\n```mermaid\ngraph TD\n  A-->B\n```');
    act(() => root.render(<MarkdownViewer src="/api/downloads/1/content" />));
    await settle();

    expect(container.querySelector('figure.mermaid svg')).not.toBeNull();
  });

  it('gets the shared renderer: highlighted code and anchored headings', async () => {
    // Not "# Title": DOMPurify's clobbering guard drops an id that collides
    // with a document property, which is a pre-existing quirk of the shared
    // renderer and nothing to do with this surface.
    serve('# Release notes\n\n```js\nconst x = 1;\n```');
    act(() => root.render(<MarkdownViewer src="/api/downloads/2/content" />));
    await settle();

    expect(container.querySelector('h1')?.id).toBe('release-notes');
    expect(container.querySelector('pre.hljs')).not.toBeNull();
    // …and no mermaid for a file that has no diagram in it.
    expect(initialize).not.toHaveBeenCalled();
  });

  it('still renders a script-bearing file inert', async () => {
    serve('hello\n\n<script>window.pwned = 1</script>');
    act(() => root.render(<MarkdownViewer src="/api/downloads/3/content" />));
    await settle();

    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('window.pwned');
  });
});
