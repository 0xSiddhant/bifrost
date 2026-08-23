// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { clearMermaidCache, renderMarkdown } from '../../core/markdown';
import { MarkdownPreview } from './MarkdownPreview';

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

const FENCE = '```mermaid\ngraph TD\n  A-->B\n```';

/** Let the pass's awaited dynamic import and render settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('MarkdownPreview', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    clearMermaidCache();
    render.mockReset();
    initialize.mockReset();
    render.mockResolvedValue({ svg: '<svg id="m"><rect width="4" height="4"/></svg>' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.removeAttribute('style');
  });

  it('runs the mermaid pass after the preview commits', async () => {
    act(() => root.render(<MarkdownPreview html={renderMarkdown(`# Doc\n\n${FENCE}`)} />));
    expect(container.querySelector('pre.mermaid-src')).not.toBeNull();

    await settle();

    expect(container.querySelector('figure.mermaid svg')).not.toBeNull();
    expect(container.querySelector('pre.mermaid-src')).toBeNull();
  });

  it('does not run it for a document with no diagram', async () => {
    act(() => root.render(<MarkdownPreview html={renderMarkdown('# Doc\n\njust prose')} />));
    await settle();
    expect(initialize).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('redraws the diagram when the theme changes', async () => {
    act(() => root.render(<MarkdownPreview html={renderMarkdown(FENCE)} />));
    await settle();
    expect(render).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.documentElement.style.setProperty('--accent', '#ff0000');
      document.documentElement.setAttribute('data-theme', 'daybreak');
      // MutationObserver callbacks are microtask-scheduled.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(render).toHaveBeenCalledTimes(2);
    document.documentElement.removeAttribute('data-theme');
  });

  it('still forwards its node to the parent (scroll sync, anchor jumps)', () => {
    const seen: (HTMLDivElement | null)[] = [];
    act(() =>
      root.render(
        <MarkdownPreview
          ref={(node) => {
            seen.push(node);
          }}
          html="<p>x</p>"
        />,
      ),
    );
    expect(seen[0]).toBe(container.querySelector('.md-preview'));
  });
});
