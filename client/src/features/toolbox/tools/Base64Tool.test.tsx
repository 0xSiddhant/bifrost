// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Base64Tool } from './Base64Tool';
import { clearToolState } from '../useToolState';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const saver = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('../../../core/saveBlob', () => saver);

/** A 1×1 PNG, as a data URI carries it. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Base64Tool', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    clearToolState();
    saver.saveBlob.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Base64Tool />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const buttonNamed = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === label,
    );

  const decode = (value: string) => {
    act(() => buttonNamed('decode')?.click());
    const area = container.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(area, value);
      area?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('offers binary output as a download named by its type', async () => {
    decode(PNG_1X1);
    expect(container.textContent).toContain('a PNG image');
    // A result, not an error: nothing is painted as one.
    expect(container.querySelector('.tool-error')).toBeNull();

    const download = buttonNamed('Download decoded.png');
    expect(download).toBeTruthy();
    act(() => download?.click());

    expect(saver.saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = saver.saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('decoded.png');
    expect(blob.type).toBe('image/png');
    const saved = new Uint8Array(await blob.arrayBuffer());
    expect(saved).toHaveLength(70);
    expect([...saved.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('falls back to .bin and octet-stream for bytes it does not recognise', () => {
    decode('GwoAACRAapBFavKcLg==');
    act(() => buttonNamed('Download decoded.bin')?.click());
    const [blob, name] = saver.saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('decoded.bin');
    expect(blob.type).toBe('application/octet-stream');
  });

  it('offers no download for text, or for Base64 that does not decode', () => {
    decode('aGVsbG8=');
    expect(buttonNamed('Download decoded.bin')).toBeUndefined();
    expect(container.querySelector('.tool-binary')).toBeNull();

    decode('not base64!!');
    expect(container.querySelector('.tool-binary')).toBeNull();
    expect(container.querySelector('.tool-error')?.textContent).toMatch(/not valid Base64/);
  });
});
