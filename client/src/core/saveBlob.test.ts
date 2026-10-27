// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveBlob, saveText } from './saveBlob';

/**
 * jsdom has no object URLs and does not download, so both are stood in for:
 * what is checked is what the browser is handed at the moment of the click.
 */
describe('saveBlob / saveText', () => {
  const created: Blob[] = [];
  const revoked: string[] = [];
  const clicks: { href: string; download: string; inDocument: boolean }[] = [];

  beforeEach(() => {
    created.length = 0;
    revoked.length = 0;
    clicks.length = 0;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download, inDocument: this.isConnected });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicks a download link that is in the document, then cleans up', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    saveBlob(blob, 'out.bin');

    expect(created).toEqual([blob]);
    expect(clicks).toEqual([{ href: 'blob:test/1', download: 'out.bin', inDocument: true }]);
    // Nothing left behind: the link is gone and the URL is released.
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(revoked).toEqual(['blob:test/1']);
  });

  it('saves text under its name and media type', async () => {
    saveText('{"realm":"midgard"}', 'stone.json', 'application/json');

    expect(clicks).toEqual([{ href: 'blob:test/1', download: 'stone.json', inDocument: true }]);
    const [blob] = created;
    expect(blob?.type).toBe('application/json');
    expect(await blob?.text()).toBe('{"realm":"midgard"}');
  });

  it('keeps text byte-exact, including characters outside ASCII', async () => {
    const text = '# Völuspá 🌉\n';
    saveText(text, 'edda.md', 'text/markdown');
    // Plain arrays: jsdom's Blob and Node's TextEncoder build their
    // Uint8Arrays in different realms, which toEqual tells apart.
    const bytes = [...new Uint8Array(await (created[0] as Blob).arrayBuffer())];
    expect(bytes).toEqual([...new TextEncoder().encode(text)]);
  });
});
