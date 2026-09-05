// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const wire = vi.hoisted(() => ({
  fetchBrotliConfig: vi.fn(),
  compressContent: vi.fn(),
  decompressContent: vi.fn(),
  sendToHermes: vi.fn(),
}));
vi.mock('./api', () => wire);

const clipboard = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../../core/copy', () => clipboard);

const detector = vi.hoisted(() => ({ detectFormat: vi.fn() }));
vi.mock('../../core/contentFormat/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/contentFormat/registry')>();
  detector.detectFormat.mockImplementation(actual.detectFormat);
  return { ...actual, detectFormat: detector.detectFormat };
});

vi.mock('../../core/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/api')>();
  return {
    ...actual,
    fetchCapabilities: vi.fn(async () => ({
      profile: 'local',
      modules: ['brotli', 'runestone', 'edda', 'groot', 'atlas', 'clipboard'],
    })),
  };
});

import { putBrotliSeed } from '../../core/brotliSeed';
import { BrotliPage } from './BrotliPage';

const CONFIG = {
  maxInputMb: 256,
  maxOutputMb: 512,
  qualities: ['fast', 'balanced', 'best'] as const,
  defaultQuality: 'balanced' as const,
};

describe('BrotliPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    vi.clearAllMocks();
    wire.fetchBrotliConfig.mockResolvedValue(CONFIG);
    wire.compressContent.mockResolvedValue(new Uint8Array([1, 2, 3]));
    clipboard.copyText.mockResolvedValue(true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async () => {
    await act(async () => {
      root.render(<BrotliPage />);
    });
  };

  /**
   * Waits for a result to actually land. The gzip comparison runs through real
   * stream machinery, so it settles a macrotask or two after `act` returns —
   * asserting straight after a click would be racing it.
   */
  const waitFor = async (ready: () => boolean) => {
    for (let attempt = 0; attempt < 50 && !ready(); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(ready(), 'the page never reached the expected state').toBe(true);
  };

  const hasResult = () => buttonNamed('Download .br') !== undefined;
  const hasDecompressed = () => buttonNamed('Download') !== undefined;

  // `button.btn` only: the mode switcher's own "Compress"/"Decompress" chips
  // are plain buttons with the same words, and matching those instead of the
  // action would make every assertion below quietly meaningless.
  const buttonNamed = (label: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll<HTMLButtonElement>('button.btn')].find((button) =>
      button.textContent?.includes(label),
    );

  const switchMode = async (label: string) => {
    const chip = [...container.querySelectorAll<HTMLButtonElement>('.rune-viewtoggle__btn')].find(
      (button) => button.textContent === label,
    );
    await act(async () => {
      chip?.click();
    });
  };

  const click = async (label: string) => {
    const button = buttonNamed(label);
    expect(button, `button "${label}"`).toBeTruthy();
    await act(async () => {
      button?.click();
    });
  };

  /** Chooses a file the way the hidden input does, which jsdom has no picker for. */
  const choose = async (index: number, file: File) => {
    const input = container.querySelectorAll('input[type=file]')[index] as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('compresses a seed on arrival, with no second click', async () => {
    putBrotliSeed({ text: '{"from":"runestone"}', sourceLabel: 'Runestone' });
    await render();
    await waitFor(hasResult);

    expect(wire.compressContent).toHaveBeenCalledTimes(1);
    expect(wire.compressContent.mock.calls[0]?.[1]).toBe('balanced');
    expect(container.textContent).toContain('Sent from Runestone');
    // Read once and cleared, so a refresh cannot silently re-apply it.
    expect(sessionStorage.getItem('bifrost.brotli.seed')).toBeNull();
  });

  it('sends each quality by name and re-runs immediately when it changes', async () => {
    putBrotliSeed({ text: 'hello brotli' });
    await render();
    await waitFor(hasResult);
    expect(wire.compressContent).toHaveBeenCalledTimes(1);

    for (const [quality, expected] of [
      ['best', 2],
      ['fast', 3],
    ] as const) {
      const radio = [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')].find(
        (input) => input.value === quality,
      );
      expect(radio, quality).toBeTruthy();
      await act(async () => {
        radio?.click();
      });
      await waitFor(() => wire.compressContent.mock.calls.length === expected);
      // Exactly one more call — not zero (needing a second button press) and
      // not a duplicate.
      expect(wire.compressContent).toHaveBeenCalledTimes(expected);
      expect(wire.compressContent.mock.calls.at(-1)?.[1]).toBe(quality);
    }
  });

  it('copies the compressed bytes as base64, decodable back to the same bytes', async () => {
    putBrotliSeed({ text: 'hello' });
    wire.compressContent.mockResolvedValue(new Uint8Array([0, 128, 255]));
    await render();
    await waitFor(hasResult);

    await click('Copy as base64');
    const copiedText = clipboard.copyText.mock.calls[0]?.[0] as string;
    expect(Uint8Array.from(atob(copiedText), (c) => c.charCodeAt(0))).toEqual(
      new Uint8Array([0, 128, 255]),
    );
  });

  it('sends compressed output to Hermes as base64', async () => {
    putBrotliSeed({ text: 'hello' });
    wire.compressContent.mockResolvedValue(new Uint8Array([1, 2, 3]));
    wire.sendToHermes.mockResolvedValue(null);
    await render();
    await waitFor(hasResult);

    await click('Send to Hermes');
    expect(wire.sendToHermes).toHaveBeenCalledWith(btoa('\x01\x02\x03'));
  });

  describe('decompressing', () => {
    const decompressTo = async (body: string | Uint8Array) => {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      wire.decompressContent.mockResolvedValue(bytes);
      await render();
      await switchMode('Decompress');
      await choose(0, new File([new Uint8Array([1])], 'thing.br'));
      await click('Decompress');
      await waitFor(hasDecompressed);
    };

    it.each([
      ['{"a":1}', 'Runestone', 'bifrost.runestone.seed', '/runestone'],
      ['<root><a/></root>', 'Atlas', 'bifrost.atlas.seed', '/atlas'],
      ['name: bifrost\nport: 4646\n', 'Groot', 'bifrost.groot.seed', '/groot'],
      ['# Notes\n\nProse here.\n\n- one\n- two\n', 'Edda', 'bifrost.edda.seed', '/edda'],
    ])('offers the right tool for %s', async (body, tool, key, route) => {
      await decompressTo(body);

      expect(container.textContent).toContain(`Open in ${tool}`);
      await click(`Open in ${tool}`);
      const seeded = JSON.parse(sessionStorage.getItem(key) ?? '{}') as { text?: string };
      expect(seeded.text).toBe(body);
      expect(navigate).toHaveBeenCalledWith(route);
    });

    it('offers nothing at all for content it does not recognise', async () => {
      await decompressTo('2026-09-05 10:00 INFO nothing structured about this line');
      expect(container.textContent).not.toContain('Open in');
    });

    it('never renders or sniffs binary output', async () => {
      await decompressTo(new Uint8Array([0x89, 0x50, 0x00, 0x4e, 0x47]));

      expect(container.textContent).toContain('binary');
      expect(container.textContent).not.toContain('Open in');
      expect(container.querySelector('.brotli-preview')).toBeNull();
      expect(detector.detectFormat).not.toHaveBeenCalled();
    });

    it('offers a download only above the display threshold, running no parser', async () => {
      // Comfortably over 8 MB and unambiguously text — so only the threshold
      // can be what stops it.
      const huge = new TextEncoder().encode('{"a":1}\n'.repeat(1_200_000));
      expect(huge.length).toBeGreaterThan(8 * 1024 * 1024);
      await decompressTo(huge);

      expect(container.querySelector('.brotli-preview')).toBeNull();
      expect(container.textContent).not.toContain('Open in');
      expect(detector.detectFormat).not.toHaveBeenCalled();
    });
  });
});
