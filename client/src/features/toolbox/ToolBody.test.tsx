// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToolBody } from './ToolBody';
import { TOOLS } from './registry';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * The registry and the switch in ToolBody are two lists that must agree. This
 * renders every registered tool, which fails loudly if one is added to the
 * registry and forgotten in the switch — the card would otherwise open an
 * empty panel with no error anywhere.
 */
describe('ToolBody', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const expanding = TOOLS.filter((tool) => !tool.to);

  it('covers every expanding tool in the registry', () => {
    expect(expanding.length).toBe(13);
  });

  for (const tool of expanding) {
    it(`renders a body for "${tool.id}"`, () => {
      act(() => root.render(<ToolBody toolId={tool.id} />));
      // Something real, not an empty fragment.
      expect(container.childElementCount).toBeGreaterThan(0);
      expect(container.textContent?.trim()).not.toBe('');
    });
  }

  it('renders nothing for an id that is not a tool', () => {
    act(() => root.render(<ToolBody toolId="not-a-tool" />));
    expect(container.childElementCount).toBe(0);
  });

  it('puts the "does not verify" warning on the JWT tool, unconditionally', () => {
    act(() => root.render(<ToolBody toolId="jwt" />));
    const text = container.textContent ?? '';
    expect(text).toMatch(/does not verify/i);
    expect(text).toMatch(/signature/i);
  });
});
