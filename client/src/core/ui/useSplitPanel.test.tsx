// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  clampSplitRatio,
  readStoredRatio,
  splitLayoutFor,
  useSplitPanel,
  SPLIT_MAX_RATIO,
  SPLIT_MIN_RATIO,
  type SplitPanel,
} from './useSplitPanel';

describe('splitLayoutFor', () => {
  it('maps the three viewport bands Edda established', () => {
    expect(splitLayoutFor(1280)).toBe('split');
    expect(splitLayoutFor(1024)).toBe('split');
    expect(splitLayoutFor(1023)).toBe('stacked');
    expect(splitLayoutFor(768)).toBe('stacked');
    expect(splitLayoutFor(767)).toBe('single');
    expect(splitLayoutFor(375)).toBe('single');
  });
});

describe('clampSplitRatio', () => {
  it('keeps either pane at 30% or more', () => {
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(0.01)).toBe(SPLIT_MIN_RATIO);
    expect(clampSplitRatio(0.99)).toBe(SPLIT_MAX_RATIO);
  });
});

describe('readStoredRatio', () => {
  it('accepts a stored value inside the clamp range', () => {
    expect(readStoredRatio('0.42')).toBeCloseTo(0.42);
  });

  it('falls back to an even split for missing or out-of-range values', () => {
    // `Number(null)` is 0, which is why the guard is a range test, not a null test.
    expect(readStoredRatio(null)).toBe(0.5);
    expect(readStoredRatio('')).toBe(0.5);
    expect(readStoredRatio('nope')).toBe(0.5);
    expect(readStoredRatio('0.05')).toBe(0.5);
    expect(readStoredRatio('0.95')).toBe(0.5);
  });
});

describe('useSplitPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let panel: SplitPanel | null = null;

  function Probe({ storageKey }: { storageKey: string }) {
    panel = useSplitPanel(storageKey);
    return (
      <div className="panes" ref={panel.panesRef}>
        <div className="divider" {...panel.dividerProps} />
      </div>
    );
  }

  const mount = (storageKey: string) => {
    act(() => {
      root.render(<Probe storageKey={storageKey} />);
    });
  };

  beforeEach(() => {
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    panel = null;
  });

  it('starts from the stored ratio and persists changes under its own key', () => {
    sessionStorage.setItem('bifrost.test.split', '0.62');
    mount('bifrost.test.split');
    expect(panel?.ratio).toBeCloseTo(0.62);
    // Written back on mount, so a consumer that never drags still has a value.
    expect(sessionStorage.getItem('bifrost.test.split')).toBe('0.62');
    expect(sessionStorage.getItem('bifrost.other.split')).toBeNull();
  });

  it('tracks the viewport across the breakpoints', () => {
    window.innerWidth = 1280;
    mount('bifrost.test.split');
    expect(panel?.layout).toBe('split');

    act(() => {
      window.innerWidth = 800;
      window.dispatchEvent(new Event('resize'));
    });
    expect(panel?.layout).toBe('stacked');

    act(() => {
      window.innerWidth = 375;
      window.dispatchEvent(new Event('resize'));
    });
    expect(panel?.layout).toBe('single');
  });

  it('drags the ratio from pointer position and clamps it at both ends', () => {
    mount('bifrost.test.split');
    const panes = container.querySelector('.panes') as HTMLDivElement;
    const divider = container.querySelector('.divider') as HTMLDivElement;
    // jsdom lays nothing out, so the measured box is the drag's only input.
    panes.getBoundingClientRect = () => ({ left: 100, width: 1000 }) as DOMRect;
    divider.setPointerCapture = () => {};
    divider.hasPointerCapture = () => false;

    const pointer = (type: string, clientX: number) =>
      act(() => {
        divider.dispatchEvent(
          new PointerEvent(type, { clientX, bubbles: true, pointerId: 1 }),
        );
      });

    // A move with no button down must not resize.
    pointer('pointermove', 700);
    expect(panel?.ratio).toBe(0.5);

    pointer('pointerdown', 500);
    pointer('pointermove', 700);
    expect(panel?.ratio).toBeCloseTo(0.6);
    expect(sessionStorage.getItem('bifrost.test.split')).toBe('0.6');

    // Past either end the pane stops shrinking rather than collapsing.
    pointer('pointermove', 1090);
    expect(panel?.ratio).toBe(SPLIT_MAX_RATIO);
    pointer('pointermove', 110);
    expect(panel?.ratio).toBe(SPLIT_MIN_RATIO);

    pointer('pointerup', 110);
    pointer('pointermove', 900);
    expect(panel?.ratio).toBe(SPLIT_MIN_RATIO);
  });
});
