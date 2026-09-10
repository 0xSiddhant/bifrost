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

  it('navigates on a swipe past the threshold, and ignores a shorter drag', async () => {
    await open('/saga');
    await drop('deck.md', DECK);

    // jsdom cannot construct a real TouchEvent, so the two properties the
    // handler actually reads are attached to a plain event of the right type.
    const swipe = (from: number, to: number) => {
      const stage = container.querySelector('.saga-stage');
      if (!stage) throw new Error('stage missing');
      const start = new Event('touchstart', { bubbles: true }) as Event & { touches: unknown[] };
      start.touches = [{ clientX: from }];
      const end = new Event('touchend', { bubbles: true }) as Event & { changedTouches: unknown[] };
      end.changedTouches = [{ clientX: to }];
      act(() => {
        stage.dispatchEvent(start);
        stage.dispatchEvent(end);
      });
    };

    swipe(300, 200); // 100px left — forward
    expect(position()).toBe('2 / 3');

    swipe(200, 300); // 100px right — back
    expect(position()).toBe('1 / 3');

    swipe(300, 270); // 30px, under the 50px threshold — a tap, not a swipe
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
    expect(container.querySelector('.saga-notes')?.textContent).toContain('breathe');
    expect(slideText()).not.toContain('breathe');

    press('n');
    expect(container.querySelector('.saga-notes')).toBeNull();
  });

  it('offers no notes toggle on a slide that has no note', async () => {
    await open('/saga');
    await drop('deck.md', DECK);

    const toggle = () => container.querySelector('[aria-label="Show presenter notes"]');
    expect(toggle()).not.toBeNull();
    press('ArrowRight');
    expect(toggle()).toBeNull();
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

  it('says so when a deck has no slides in it', async () => {
    await open('/saga');
    await drop('empty.md', '   \n\n');
    expect(container.textContent).toContain('Nothing to present');
  });
});
