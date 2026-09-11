// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShortcutsOverlay } from './ShortcutsOverlay';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

describe('ShortcutsOverlay (PLAN-28, PLAN-29)', () => {
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

  const render = (props: { canFullscreen?: boolean; canNotes?: boolean } = {}) =>
    act(() =>
      root.render(
        <ShortcutsOverlay canFullscreen canNotes {...props} onClose={() => {}} />,
      ),
    );

  const keys = () => [...container.querySelectorAll('dt')].map((node) => node.textContent);
  const says = (key: string) =>
    [...container.querySelectorAll('.saga-shortcuts__row')].find(
      (row) => row.querySelector('dt')?.textContent === key,
    )?.querySelector('dd')?.textContent;

  it('lists every binding, whatever the deck is made of', () => {
    const markdown = (() => {
      render();
      return keys();
    })();
    act(() => root.render(<ShortcutsOverlay canFullscreen canNotes={false} onClose={() => {}} />));
    expect(keys()).toEqual(markdown);
  });

  it('says notes are markdown-only rather than dropping the row on a PDF deck', () => {
    // `F` on an iPhone is a key the browser will never honour, so that row goes
    // entirely. `N` is a real binding this deck has nothing to show for, which
    // is a different thing and worth saying.
    render({ canNotes: false });
    expect(says('N')).toBe('Presenter notes — markdown decks only');
  });

  it('describes the notes binding plainly on a markdown deck', () => {
    render();
    expect(says('N')).toBe('Show or hide presenter notes');
  });

  it('drops the fullscreen row where the browser has no fullscreen', () => {
    render({ canFullscreen: false });
    expect(keys()).not.toContain('F');
    expect(says('Esc')).toBe('Close this list');
  });
});
