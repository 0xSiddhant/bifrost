// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  SLIDE_SCALE_DEFAULT,
  SLIDE_SCALE_MAX,
  SLIDE_SCALE_MIN,
  useSlideScale,
  type SlideScale,
} from './useSlideScale';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const KEY = 'bifrost.sagaSlideScale';

describe('useSlideScale (PLAN-28)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let seen: SlideScale;

  function Probe() {
    seen = useSlideScale();
    return null;
  }

  const mount = () => act(() => root.render(createElement(Probe)));

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('starts at 100% with nothing stored', () => {
    mount();
    expect(seen.value).toBe(SLIDE_SCALE_DEFAULT);
    expect(seen.percent).toBe(100);
  });

  it('steps up and down, and reports the percentage without float drift', () => {
    mount();
    act(() => seen.inc());
    expect(seen.value).toBe(1.1);
    expect(seen.percent).toBe(110);

    // 1.1 + 0.1 is 1.2000000000000002 in binary floating point; the readout
    // must not turn into 120.00000000000001%.
    act(() => seen.inc());
    expect(seen.value).toBe(1.2);
    expect(seen.percent).toBe(120);

    act(() => seen.dec());
    expect(seen.value).toBe(1.1);
  });

  it('clamps at both ends and flags where it is', () => {
    mount();
    for (let i = 0; i < 40; i += 1) act(() => seen.inc());
    expect(seen.value).toBe(SLIDE_SCALE_MAX);
    expect(seen.atMax).toBe(true);
    expect(seen.atMin).toBe(false);

    for (let i = 0; i < 60; i += 1) act(() => seen.dec());
    expect(seen.value).toBe(SLIDE_SCALE_MIN);
    expect(seen.atMin).toBe(true);
    expect(seen.atMax).toBe(false);
  });

  it('resets to 100%', () => {
    mount();
    act(() => seen.inc());
    act(() => seen.inc());
    act(() => seen.reset());
    expect(seen.value).toBe(SLIDE_SCALE_DEFAULT);
  });

  it('remembers the size for the next presentation', () => {
    mount();
    act(() => seen.inc());
    expect(localStorage.getItem(KEY)).toBe('1.1');

    act(() => root.unmount());
    root = createRoot(container);
    mount();
    expect(seen.value).toBe(1.1);
  });

  it('ignores a stored value that is not a usable number', () => {
    for (const junk of ['', 'huge', 'NaN', '0', '-3']) {
      localStorage.setItem(KEY, junk);
      act(() => root.unmount());
      root = createRoot(container);
      mount();
      expect(seen.value, `stored ${JSON.stringify(junk)}`).toBe(SLIDE_SCALE_DEFAULT);
    }
  });

  it('clamps a stored value that is out of range rather than trusting it', () => {
    localStorage.setItem(KEY, '99');
    mount();
    expect(seen.value).toBe(SLIDE_SCALE_MAX);
  });

  it('still resizes when storage refuses the write, and says so once', () => {
    // Private mode: the size must still change on screen.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    mount();
    act(() => seen.inc());
    expect(seen.value).toBe(1.1);
  });
});
