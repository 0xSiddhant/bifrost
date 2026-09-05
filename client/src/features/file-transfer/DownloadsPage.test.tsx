// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DownloadEntry } from '../../core/api';
import { DownloadFolderPage } from './DownloadFolderPage';
import { DownloadsPage } from './DownloadsPage';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const entry = (over: Partial<DownloadEntry> & { id: string; name: string }): DownloadEntry => ({
  size: 100,
  mtime: 1,
  ext: '',
  type: 'file',
  parent: null,
  ...over,
});

const ENTRIES: DownloadEntry[] = [
  entry({ id: 'root0000000000001', name: 'loose.txt', ext: '.txt', size: 10, mtime: 40 }),
  entry({ id: 'fold0000000000001', name: 'Trip photos', type: 'folder', size: 0, mtime: 30 }),
  entry({
    id: 'kid00000000000001',
    name: 'a.jpg',
    ext: '.jpg',
    parent: 'Trip photos',
    size: 200,
    mtime: 20,
  }),
  entry({
    id: 'kid00000000000002',
    name: 'b.jpg',
    ext: '.jpg',
    parent: 'Trip photos',
    size: 300,
    mtime: 10,
  }),
  entry({ id: 'kid00000000000003', name: 'other.txt', ext: '.txt', parent: 'Receipts', mtime: 5 }),
];

/** One shared feed for both views — the hook is called, never re-implemented. */
const useDownloads = vi.fn(() => ({ entries: ENTRIES, sseStatus: 'open' as const }));
vi.mock('./useDownloads', () => ({ useDownloads: () => useDownloads() }));

describe('Receive views over one shared feed (PLAN-24)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useDownloads.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (path: string) =>
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route path="/downloads/folder/:folderId" element={<DownloadFolderPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });

  const rowNames = () =>
    [...container.querySelectorAll('.file-row__name')].map((el) => el.textContent);

  it('shows only root-level entries on the Receive page', () => {
    render('/downloads');

    // Criterion 7: files and folders together, and no nested file leaks in.
    expect(rowNames()).toEqual(['loose.txt', 'Trip photos']);
  });

  it('gives a folder row a name that opens it and its own zip icon', () => {
    render('/downloads');

    const link = container.querySelector<HTMLAnchorElement>('.file-row__link');
    expect(link?.textContent).toBe('Trip photos');
    expect(link?.getAttribute('href')).toBe('/downloads/folder/fold0000000000001');

    // Criterion 11: the zip needs no navigation.
    const zip = container.querySelector<HTMLAnchorElement>(
      '[aria-label="Download Trip photos as a zip"]',
    );
    expect(zip?.getAttribute('href')).toBe('/api/downloads/fold0000000000001/archive');
  });

  it('sums a folder’s children from the same feed rather than trusting its size', () => {
    render('/downloads');

    const meta = [...container.querySelectorAll('.file-row')]
      .find((row) => row.textContent?.includes('Trip photos'))
      ?.querySelector('.file-row__meta');
    expect(meta?.textContent).toContain('2 files');
    // 200 + 300 bytes, not the folder entry's own size of 0.
    expect(meta?.textContent).toContain('500 B');
  });

  it('shows only that folder’s children on the folder page', () => {
    render('/downloads/folder/fold0000000000001');

    expect(rowNames()).toEqual(['a.jpg', 'b.jpg']);
    expect(container.textContent).toContain('Trip photos');
    // Criterion 12: each file keeps its own preview and download actions.
    expect(container.querySelector('[aria-label="Preview a.jpg"]')).toBeTruthy();
    expect(
      container.querySelector<HTMLAnchorElement>('[aria-label="Download a.jpg"]')?.href,
    ).toContain('/api/downloads/kid00000000000001/content');
  });

  it('offers the explicit zip button and a way back on the folder page', () => {
    render('/downloads/folder/fold0000000000001');

    const zip = [...container.querySelectorAll('a')].find((el) =>
      el.textContent?.includes('Download folder as .zip'),
    );
    expect(zip?.getAttribute('href')).toBe('/api/downloads/fold0000000000001/archive');
    const back = [...container.querySelectorAll('a')].find((el) =>
      el.textContent?.includes('Back to Receive'),
    );
    expect(back?.getAttribute('href')).toBe('/downloads');
  });

  it('says so plainly when the folder is not in the listing', () => {
    render('/downloads/folder/gone0000000000001');

    expect(container.textContent).toContain('not on the bridge');
    expect(rowNames()).toEqual([]);
  });

  /**
   * Icon-only actions say what they do on hover and on focus — the file name
   * is on the row, but the icon alone is not self-evident. The hint text
   * matches the `aria-label` so the two cannot drift into telling different
   * stories, and it rides `.tip`'s `data-tip` rather than a native `title`,
   * which waits about a second and paints in an unstyleable OS layer.
   */
  it('names every icon-only action on hover, on both views', () => {
    render('/downloads');

    const hoverable = ['Preview loose.txt', 'Download loose.txt', 'Download Trip photos as a zip'];
    for (const label of hoverable) {
      const el = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
      expect(el?.getAttribute('data-tip'), label).toBe(label);
      // Without the class the attribute renders nothing at all.
      expect(el?.classList.contains('tip'), label).toBe(true);
    }

    act(() => root.unmount());
    root = createRoot(container);
    render('/downloads/folder/fold0000000000001');

    for (const label of ['Preview a.jpg', 'Download a.jpg']) {
      const el = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
      expect(el?.getAttribute('data-tip'), label).toBe(label);
      expect(el?.classList.contains('tip'), label).toBe(true);
    }
  });

  it('subscribes to the feed once per view, never twice', () => {
    render('/downloads');
    // React 19 renders once here (no StrictMode double-render in this harness);
    // what matters is that the page owns exactly one subscription, not two.
    expect(useDownloads).toHaveBeenCalledTimes(1);
  });
});
