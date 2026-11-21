// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setSnowfallEnabled } from '../relicPrefs';
import { themeEngine } from '../theme';
import { FooterScene } from './FooterScene';
import { Snowfall } from './Snowfall';
import { StringLights } from './StringLights';
import { optInLevel } from './useThemeOptIn';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

/** The IntersectionObserver the footer scene made, to drive it by hand. */
let observed: ((entries: Partial<IntersectionObserverEntry>[]) => void) | null = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  observed = null;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderDecor() {
  act(() =>
    root.render(
      <>
        <Snowfall />
        <StringLights />
        <FooterScene />
      </>,
    ),
  );
}

const $ = (selector: string) => container.querySelectorAll(selector);

describe('the opt-in decorations', () => {
  it('draw snow, lights and the footer scene in a theme that turns them on', () => {
    act(() => themeEngine.setTheme('yule'));
    renderDecor();

    // jsdom's 1024×768 viewport: flakeCount gives it 112 flakes, in two fields.
    expect($('.snowflake')).toHaveLength(112);
    expect($('.snowfall__field')).toHaveLength(2);
    expect($('.string-lights__bulbs')).toHaveLength(4);
    expect($('.footer-scene')).toHaveLength(1);
    // The snowbank under the drifts fills the footer itself.
    expect($('.footer-scene__bank')).toHaveLength(1);
    for (const element of $('.snowfall, .string-lights, .footer-scene')) {
      expect(element.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('render nothing at all in a theme without them, and follow a theme switch', () => {
    act(() => themeEngine.setTheme('aurora'));
    renderDecor();
    expect(container.innerHTML).toBe('');

    act(() => themeEngine.setTheme('yule'));
    expect($('.snowfall')).toHaveLength(1);
    expect($('.string-lights')).toHaveLength(1);

    act(() => themeEngine.setTheme('halloween'));
    expect(container.innerHTML).toBe('');
  });

  it("take the snow away when this device's Snowfall switch is off, and bring it back", () => {
    act(() => themeEngine.setTheme('yule'));
    renderDecor();

    act(() => setSnowfallEnabled(false));
    expect($('.snowfall')).toHaveLength(0);
    // The switch is for the snow alone.
    expect($('.string-lights')).toHaveLength(1);
    expect($('.footer-scene')).toHaveLength(1);

    act(() => setSnowfallEnabled(true));
    expect($('.snowfall')).toHaveLength(1);
  });

  it('let the sleigh ride only while the footer is on screen', () => {
    act(() => themeEngine.setTheme('yule'));
    renderDecor();
    const scene = () => container.querySelector('.footer-scene');

    expect(scene()?.classList.contains('footer-scene--riding')).toBe(false);
    act(() => observed?.([{ isIntersecting: true }]));
    expect(scene()?.classList.contains('footer-scene--riding')).toBe(true);
    act(() => observed?.([{ isIntersecting: false }]));
    expect(scene()?.classList.contains('footer-scene--riding')).toBe(false);
  });
});

describe('optInLevel', () => {
  it('reads a 0–1 token, and anything else as off', () => {
    expect(optInLevel({ '--snow-alpha': '1' }, '--snow-alpha')).toBe(1);
    expect(optInLevel({ '--snow-alpha': '0.6' }, '--snow-alpha')).toBe(0.6);
    expect(optInLevel({ '--snow-alpha': '3' }, '--snow-alpha')).toBe(1);
    expect(optInLevel({ '--snow-alpha': '0' }, '--snow-alpha')).toBe(0);
    expect(optInLevel({ '--snow-alpha': 'lots' }, '--snow-alpha')).toBe(0);
    expect(optInLevel({}, '--snow-alpha')).toBe(0);
  });
});
