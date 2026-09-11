// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as edda from '../../core/edda';
import { SagaPage } from './SagaPage';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const DECK = [
  '# First',
  '',
  '<!-- notes: breathe -->',
  '',
  'Opening words.',
  '',
  '---',
  '',
  '# Second',
  '',
  '---',
  '',
  '# Third',
].join('\n');

/**
 * jsdom ships `URL.createObjectURL` but its `fetch` cannot read a blob URL's
 * body back (it answers 200 with nothing). So the `File` and the object URL are
 * real — the component genuinely creates and revokes one — and only the
 * transport between them is bridged here, by resolving the URL through the same
 * registry the drop populated. The un-bridged end-to-end path is what the
 * live-verify pass proves in a real browser.
 */
const blobs = new Map<string, string>();
const realCreate = URL.createObjectURL.bind(URL);
const revoked: string[] = [];

describe('SagaPage (PLAN-28)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    blobs.clear();
    revoked.length = 0;
    localStorage.clear();

    vi.spyOn(URL, 'createObjectURL').mockImplementation((source: Blob | MediaSource) => {
      const url = realCreate(source as Blob);
      void (source as Blob).text().then((text) => blobs.set(url, text));
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url);
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string) =>
      Promise.resolve(new Response(blobs.get(String(url)) ?? '', { status: 200 }))) as typeof fetch);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  /** Render at `entry`, letting the load promise chain settle. */
  async function open(entry: string) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/saga" element={<SagaPage />} />
            <Route path="/saga/:slug" element={<SagaPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    await settle();
  }

  const settle = () =>
    act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

  const slideText = () => container.querySelector('.saga-slide__body')?.textContent ?? '';
  const position = () => container.querySelector('.saga-footer__position')?.textContent;
  const press = (key: string) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });

  /** Drop a real `File` on the landing zone. */
  async function drop(name: string, text: string) {
    const file = new File([text], name, { type: 'text/markdown' });
    const zone = container.querySelector('.saga-drop');
    if (!zone) throw new Error('dropzone missing');
    const event = new Event('drop', { bubbles: true }) as Event & {
      dataTransfer: { files: File[] };
    };
    event.dataTransfer = { files: [file] };
    await act(async () => {
      zone.dispatchEvent(event);
    });
    await settle();
    await settle();
  }

  it('shows the dropzone at the bare route, with no slug and no source', async () => {
    await open('/saga');
    expect(container.querySelector('.saga-drop')).not.toBeNull();
    expect(container.querySelector('.saga-footer')).toBeNull();
  });

  it('renders a dropped markdown file as slides', async () => {
    await open('/saga');
    await drop('deck.md', DECK);

    expect(container.querySelector('.saga-drop')).toBeNull();
    expect(slideText()).toContain('First');
    expect(position()).toBe('1 / 3');
  });

  it('refuses a file that is not markdown, without leaving the landing state', async () => {
    await open('/saga');
    await drop('data.json', '{"a":1}');

    expect(container.querySelector('.saga-drop')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('.md');
  });

  it('revokes the object URL when the page goes away', async () => {
    await open('/saga');
    await drop('deck.md', DECK);
    expect(revoked).toHaveLength(0);

    act(() => root.unmount());
    root = createRoot(container);
    expect(revoked).toHaveLength(1);
  });

  it('navigates with every documented binding', async () => {
    await open('/saga');
    await drop('deck.md', DECK);
    expect(position()).toBe('1 / 3');

    // One mount, reset between keys — the deck's position is the state under
    // test, and Home/End are already pinned by their own case below.
    for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'd', 'D', 's', 'S']) {
      press('Home');
      press(key);
      expect(position(), `${key} advances`).toBe('2 / 3');
    }

    for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'a', 'A', 'w', 'W']) {
      press('End');
      press(key);
      expect(position(), `${key} goes back`).toBe('2 / 3');
    }
  });

  it('leaves a keypress carrying a modifier to the browser', async () => {
    await open('/saga');
    await drop('deck.md', DECK);
    // ⌘→ is Forward, not "next slide".
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true }));
    });
    expect(position()).toBe('1 / 3');
  });

  it('never navigates on a touch drag — the deck scrolls, it does not turn', async () => {
    // Swipe used to measure horizontal distance without checking the gesture
    // *was* horizontal, so scrolling a long slide on a phone turned the page
    // whenever a finger drifted past 50px. On a surface whose whole job is to
    // scroll, a drag belongs to the content.
    await open('/saga');
    await drop('deck.md', DECK);

    const drag = (fromX: number, toX: number, fromY = 400, toY = 400) => {
      const stage = container.querySelector('.saga-stage');
      if (!stage) throw new Error('stage missing');
      const start = new Event('touchstart', { bubbles: true }) as Event & { touches: unknown[] };
      start.touches = [{ clientX: fromX, clientY: fromY }];
      const end = new Event('touchend', { bubbles: true }) as Event & { changedTouches: unknown[] };
      end.changedTouches = [{ clientX: toX, clientY: toY }];
      act(() => {
        stage.dispatchEvent(start);
        stage.dispatchEvent(end);
      });
    };

    drag(300, 100); // a long leftward drag — once a "next slide"
    expect(position()).toBe('1 / 3');
    drag(100, 300); // and rightward
    expect(position()).toBe('1 / 3');
    drag(300, 200, 600, 100); // a vertical scroll that drifts sideways
    expect(position()).toBe('1 / 3');
  });

  it('Home and End jump to the ends and clamp there', async () => {
    await open('/saga');
    await drop('deck.md', DECK);

    press('End');
    expect(position()).toBe('3 / 3');
    press('ArrowRight');
    expect(position()).toBe('3 / 3');

    press('Home');
    expect(position()).toBe('1 / 3');
    press('ArrowLeft');
    expect(position()).toBe('1 / 3');
  });

  it('opens and closes the shortcuts overlay, suspending navigation while open', async () => {
    await open('/saga');
    await drop('deck.md', DECK);

    press('?');
    expect(container.querySelector('.saga-shortcuts')).not.toBeNull();
    expect(container.querySelector('.saga-shortcuts')?.textContent).toContain('Next slide');
    expect(container.querySelector('.saga-shortcuts')?.textContent).not.toContain('Swipe');

    // Acceptance 4's bindings must not move the deck behind an open overlay.
    press('ArrowRight');
    expect(position()).toBe('1 / 3');

    press('Escape');
    expect(container.querySelector('.saga-shortcuts')).toBeNull();
    press('ArrowRight');
    expect(position()).toBe('2 / 3');
  });

  it('H opens the same overlay as ?', async () => {
    await open('/saga');
    await drop('deck.md', DECK);
    press('h');
    expect(container.querySelector('.saga-shortcuts')).not.toBeNull();
  });

  it('shows a note in the panel and never in the slide body', async () => {
    await open('/saga');
    await drop('deck.md', DECK);

    expect(slideText()).not.toContain('breathe');
    expect(container.querySelector('.saga-notes')).toBeNull();

    press('n');
    expect(container.querySelector('.saga-notes__body')?.textContent).toContain('breathe');
    expect(slideText()).not.toContain('breathe');

    press('n');
    expect(container.querySelector('.saga-notes')).toBeNull();
  });

  it('N always answers, even on a slide the author never annotated', async () => {
    // The reported bug: showing notes is a *mode*, but the panel only rendered
    // on slides that had one — so on every other slide the key did nothing
    // visible and read as broken.
    await open('/saga');
    await drop('deck.md', DECK);

    press('ArrowRight');
    expect(container.querySelector('.saga-slide__body')?.textContent).toContain('Second');
    press('n');

    const panel = container.querySelector('.saga-notes');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('Nothing written for this slide');
    expect(container.querySelector('.saga-notes__body')).toBeNull();
  });

  it('keeps the notes toggle on every slide', async () => {
    await open('/saga');
    await drop('deck.md', DECK);

    const toggle = () => container.querySelector('[aria-label="Show presenter notes"]');
    expect(toggle()).not.toBeNull();
    press('ArrowRight');
    expect(toggle()).not.toBeNull();
  });

  const scaleOf = () =>
    container.querySelector<HTMLElement>('.saga')?.style.getPropertyValue('--saga-scale');

  it('resizes the slide text with + and -, and 0 puts it back', async () => {
    await open('/saga');
    await drop('deck.md', DECK);
    expect(scaleOf()).toBe('1');

    press('+');
    expect(scaleOf()).toBe('1.1');
    press('=');
    expect(scaleOf()).toBe('1.2');
    press('-');
    expect(scaleOf()).toBe('1.1');
    press('0');
    expect(scaleOf()).toBe('1');
  });

  it('keeps the chosen size across the fullscreen toggle', async () => {
    // The whole point of the request: a deck sized for the room must not snap
    // back to 100% the moment it is actually presented.
    await open('/saga');
    await drop('deck.md', DECK);
    press('+');
    press('+');
    expect(scaleOf()).toBe('1.2');

    const container_ = container.querySelector<HTMLElement>('.saga');
    if (!container_) throw new Error('saga container missing');
    // jsdom implements neither requestFullscreen nor document.fullscreenElement,
    // so the mode switch is driven the way the browser would report it. The real
    // requestFullscreen call is proven in live-verify.
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: container_,
    });
    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(container.querySelector('.saga')?.className).toContain('saga--presenting');
    expect(scaleOf()).toBe('1.2');

    press('+');
    expect(scaleOf()).toBe('1.3');

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(container.querySelector('.saga')?.className).not.toContain('saga--presenting');
    expect(scaleOf()).toBe('1.3');
  });

  it('does not resize the deck behind an open shortcuts overlay', async () => {
    await open('/saga');
    await drop('deck.md', DECK);
    press('?');
    press('+');
    expect(scaleOf()).toBe('1');
  });

  it('presents a saved edda by slug', async () => {
    vi.spyOn(edda, 'fetchEdda').mockResolvedValue({
      id: 'abc123',
      name: 'A Saved Deck',
      slug: 'a-saved-deck-abc123',
      authorDeviceId: null,
      sizeBytes: DECK.length,
      createdAt: 1,
      modifiedAt: 1,
      content: DECK,
    });

    await open('/saga/a-saved-deck-abc123');
    expect(slideText()).toContain('First');
    expect(position()).toBe('1 / 3');
  });

  it('says so when the slug names nothing', async () => {
    vi.spyOn(edda, 'fetchEdda').mockResolvedValue(null);
    await open('/saga/missing');
    expect(container.textContent).toContain('never written');
  });

  it('loads a ?source= URL through the same loader', async () => {
    blobs.set('http://127.0.0.1:5000/payload', DECK);
    await open('/saga?source=http%3A%2F%2F127.0.0.1%3A5000%2Fpayload');
    expect(slideText()).toContain('First');
    expect(position()).toBe('1 / 3');
  });

  it('offers nothing and does nothing where the browser has no fullscreen', async () => {
    // Safari on iPhone exposes the Fullscreen API on <video> and nowhere else.
    // jsdom is the same shape — it implements neither — so this is the real
    // code path that device takes, not a simulation of it.
    await open('/saga');
    await drop('deck.md', DECK);
    const el = container.querySelector<HTMLElement>('.saga');
    expect(el && 'requestFullscreen' in el).toBe(false);

    expect(container.querySelector('[aria-label="Enter fullscreen"]')).toBeNull();
    press('f');
    expect(container.querySelector('.saga')?.className).not.toContain('saga--presenting');

    // The shortcuts card must not advertise a key that cannot do anything.
    press('?');
    const rows = container.querySelector('.saga-shortcuts')?.textContent ?? '';
    expect(rows).not.toContain('fullscreen');
    expect(rows).toContain('Close this list');
  });

  it('uses the real API where the browser has one', async () => {
    // Patched on the prototype *before* mounting, because support is read once
    // for the real element — which is the same order a browser presents it in.
    const request = vi.fn(async function (this: Element) {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: this });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: request,
    });
    try {
      await open('/saga');
      await drop('deck.md', DECK);
      expect(container.querySelector('[aria-label="Enter fullscreen"]')).not.toBeNull();

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
      });

      expect(request).toHaveBeenCalledOnce();
      expect(container.querySelector('.saga')?.className).toContain('saga--presenting');

      // The browser owns leaving, and the page follows it rather than guessing.
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      await act(async () => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      expect(container.querySelector('.saga')?.className).not.toContain('saga--presenting');
    } finally {
      delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    }
  });

  it('says so when a deck has no slides in it', async () => {
    await open('/saga');
    await drop('empty.md', '   \n\n');
    expect(container.textContent).toContain('Nothing to present');
  });
});
