// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DecorSlot } from '../../core/decor/DecorSlot';
import { setDecorationEnabled } from '../../core/decor/prefs';
import { installSeason } from '../../core/decor/registry';
import { themeEngine } from '../../core/theme';
import { WINTER_COMPONENTS } from './components';
import { FooterScene } from './FooterScene';
import { WINTER } from '.';
import { Snowfall } from './Snowfall';
import { StringLights } from './StringLights';

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
  installSeason(null);
});

const $ = (selector: string) => container.querySelectorAll(selector);

async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe('the winter season', () => {
  it('maps every decoration its manifest declares to a component, in a known slot', () => {
    expect(Object.keys(WINTER_COMPONENTS).sort()).toEqual(
      WINTER.decorations.map((decoration) => decoration.id).sort(),
    );
    expect(WINTER.decorations.map((d) => `${d.id}:${d.slot}`)).toEqual([
      'snowfall:sky',
      'string-lights:header',
      'footer-scene:footer',
    ]);
    // Only the snow has a per-device switch.
    expect(WINTER.decorations.filter((d) => d.switchable).map((d) => d.id)).toEqual(['snowfall']);
  });

  it('draws its decorations, hidden from assistive tech', () => {
    act(() =>
      root.render(
        <>
          <Snowfall />
          <StringLights />
          <FooterScene />
        </>,
      ),
    );
    // jsdom's 1024×768 viewport: flakeCount gives it 112 flakes, in two fields.
    expect($('.snowflake')).toHaveLength(112);
    expect($('.snowfall__field')).toHaveLength(2);
    expect($('.string-lights__bulbs')).toHaveLength(4);
    expect($('.footer-scene__bank')).toHaveLength(1);
    for (const element of $('.snowfall, .string-lights, .footer-scene')) {
      expect(element.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('stops its Web Animations the moment reduced motion turns on, and restarts them when it turns off', () => {
    // A live media query and a recording `element.animate` (jsdom has neither).
    let reduced = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      get matches() {
        return reduced;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));
    const started: { cancel: ReturnType<typeof vi.fn> }[] = [];
    const animate = vi.fn(() => {
      const animation = { cancel: vi.fn(), pause: vi.fn(), play: vi.fn() };
      started.push(animation);
      return animation;
    });
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true });
    try {
      act(() =>
        root.render(
          <>
            <Snowfall />
            <StringLights />
          </>,
        ),
      );
      const first = started.length;
      expect(first).toBeGreaterThan(0);

      reduced = true;
      act(() => listeners.forEach((listener) => listener()));
      expect(started.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
      expect(started).toHaveLength(first);

      reduced = false;
      act(() => listeners.forEach((listener) => listener()));
      expect(started).toHaveLength(first * 2);
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate;
    }
  });

  it('lets the sleigh ride only while the footer is on screen', () => {
    act(() => root.render(<FooterScene />));
    const scene = () => container.querySelector('.footer-scene');
    expect(scene()?.classList.contains('footer-scene--riding')).toBe(false);
    act(() => observed?.([{ isIntersecting: true }]));
    expect(scene()?.classList.contains('footer-scene--riding')).toBe(true);
    act(() => observed?.([{ isIntersecting: false }]));
    expect(scene()?.classList.contains('footer-scene--riding')).toBe(false);
  });

  it("plugs into the shell's slots: Yule turns it on, another theme and the switch take it off", async () => {
    installSeason(WINTER);
    act(() => themeEngine.setTheme('yule'));
    act(() =>
      root.render(
        <>
          <DecorSlot slot="sky" />
          <DecorSlot slot="header" />
          <DecorSlot slot="footer" />
        </>,
      ),
    );
    await settle(() => $('.footer-scene').length > 0 && $('.snowflake').length > 0);
    expect($('.snowflake').length).toBeGreaterThan(0);
    expect($('.string-lights')).toHaveLength(1);
    expect($('.footer-scene')).toHaveLength(1);

    act(() => setDecorationEnabled('snowfall', false));
    expect($('.snowflake')).toHaveLength(0);
    expect($('.string-lights')).toHaveLength(1);
    act(() => setDecorationEnabled('snowfall', true));

    act(() => themeEngine.setTheme('aurora'));
    expect($('.snowflake, .string-lights, .footer-scene')).toHaveLength(0);
  });
});
