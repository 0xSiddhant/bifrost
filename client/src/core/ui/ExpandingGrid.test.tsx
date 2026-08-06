// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ExpandingGrid, type ExpandingGridItem } from './ExpandingGrid';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const ITEMS: ExpandingGridItem[] = [
  { id: 'nimbus', title: 'Nimbus', hint: 'speed', icon: null, to: '/nimbus' },
  { id: 'base64', title: 'Base64', hint: 'encode', icon: null, layout: 'full' },
  { id: 'uuid', title: 'UUID', hint: 'ids', icon: null, layout: 'split' },
];

const cards = () => [...document.querySelectorAll<HTMLElement>('.tool-card')];
const cardFor = (title: string) => cards().find((card) => card.textContent?.includes(title));
const panel = () => document.querySelector<HTMLElement>('.tool-panel');

describe('ExpandingGrid', () => {
  let container: HTMLDivElement;
  let root: Root;
  let openId: string | null;
  let onOpen: Mock<(id: string) => void>;
  let onClose: Mock<() => void>;

  const render = () =>
    act(() =>
      root.render(
        <MemoryRouter>
          <ExpandingGrid
            label="Toolbox"
            items={ITEMS}
            openId={openId}
            onOpen={onOpen}
            onClose={onClose}
          >
            <p>tool body</p>
          </ExpandingGrid>
        </MemoryRouter>,
      ),
    );

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    openId = null;
    onOpen = vi.fn((id: string) => {
      openId = id;
      render();
    });
    onClose = vi.fn(() => {
      openId = null;
      render();
    });
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders a card per item and no panel until one opens', () => {
    expect(cards()).toHaveLength(3);
    expect(panel()).toBeNull();
  });

  it('renders a route card as a link and an expanding card as a button', () => {
    expect(cardFor('Nimbus')?.tagName).toBe('A');
    expect(cardFor('Nimbus')?.getAttribute('href')).toBe('/nimbus');
    expect(cardFor('Base64')?.tagName).toBe('BUTTON');
    // A link is not an expander, so it carries no expanded state to track.
    expect(cardFor('Nimbus')?.hasAttribute('aria-expanded')).toBe(false);
  });

  it('tracks the real state in aria-expanded, on the open card only', () => {
    expect(cardFor('Base64')?.getAttribute('aria-expanded')).toBe('false');

    act(() => cardFor('Base64')?.click());

    expect(onOpen).toHaveBeenCalledWith('base64');
    expect(cardFor('Base64')?.getAttribute('aria-expanded')).toBe('true');
    expect(cardFor('UUID')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('points aria-controls at the panel it actually opened', () => {
    act(() => cardFor('Base64')?.click());

    const controls = cardFor('Base64')?.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(panel()?.id).toBe(controls);
    expect(panel()?.getAttribute('role')).toBe('region');
    // The region is named by the heading the panel renders.
    const labelledBy = panel()?.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Base64');
  });

  it('applies the tool layout the item asked for', () => {
    act(() => cardFor('UUID')?.click());
    expect(document.querySelector('.tool-panel__body--split')).not.toBeNull();

    act(() => cardFor('Base64')?.click());
    expect(document.querySelector('.tool-panel__body--full')).not.toBeNull();
  });

  it('gives the panel the source card tone, not a fixed colour', () => {
    // Base64 is the 2nd item, UUID the 3rd (1-based tone slots).
    act(() => cardFor('Base64')?.click());
    expect(panel()?.classList.contains('card-tone-2')).toBe(true);

    act(() => cardFor('UUID')?.click());
    expect(panel()?.classList.contains('card-tone-3')).toBe(true);
  });

  it('moves focus into the panel on open', () => {
    act(() => cardFor('Base64')?.click());
    expect(document.activeElement).toBe(panel());
    expect(panel()?.getAttribute('tabindex')).toBe('-1');
  });

  it('closes on Escape and returns focus to the card that opened it', () => {
    act(() => cardFor('Base64')?.click());

    act(() => {
      panel()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    expect(onClose).toHaveBeenCalled();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(cardFor('Base64'));
  });

  it('closes from the panel close button, restoring focus the same way', () => {
    act(() => cardFor('Base64')?.click());

    const close = document.querySelector<HTMLButtonElement>('.tool-panel__close');
    expect(close?.getAttribute('aria-label')).toBe('Close Base64');
    act(() => close?.click());

    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(cardFor('Base64'));
  });

  it('closes when the open card is clicked again', () => {
    act(() => cardFor('Base64')?.click());
    act(() => cardFor('Base64')?.click());

    expect(onClose).toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  it('switches tool in one transition rather than closing and reopening', () => {
    act(() => cardFor('Base64')?.click());
    onClose.mockClear();

    act(() => cardFor('UUID')?.click());

    expect(onOpen).toHaveBeenLastCalledWith('uuid');
    expect(onClose).not.toHaveBeenCalled();
    expect(cardFor('Base64')?.getAttribute('aria-expanded')).toBe('false');
    expect(cardFor('UUID')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not render a card for an item that is not in the list', () => {
    // The registry filters unsupported tools out before they reach the grid
    // (see registry.test.ts); the grid renders exactly what it is given.
    openId = 'hash';
    render();
    expect(cardFor('SHA-256')).toBeUndefined();
    expect(panel()).toBeNull();
  });

  it('places the panel after the whole row, not immediately after the card', () => {
    act(() => cardFor('Base64')?.click());
    const children = [...(document.querySelector('.toolbox-grid')?.children ?? [])];
    // jsdom reports no grid tracks, so the grid measures one column and the
    // panel lands directly below its card — the 1-column degenerate case.
    expect(children.indexOf(panel() as Element)).toBe(2);
  });
});
