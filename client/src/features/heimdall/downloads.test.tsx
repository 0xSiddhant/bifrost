// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { notifications } from '../../core/notify';
import type { DownloadEntry } from '../../core/api';
import { HeimdallDownloadsSection } from './DownloadsSection';
import * as api from './api';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    fetchDownloads: vi.fn(),
    deleteDownload: vi.fn(async () => null),
  };
});

const folder: DownloadEntry = {
  id: 'AAAAAAAAAAAAAAAA',
  name: 'Trip photos',
  size: 0,
  mtime: 1,
  ext: '',
  type: 'folder',
  parent: null,
};

const file: DownloadEntry = {
  id: 'BBBBBBBBBBBBBBBB',
  name: 'report & final.txt',
  size: 12,
  mtime: 1,
  ext: '.txt',
  type: 'file',
  parent: 'Trip photos',
};

const rootFile: DownloadEntry = {
  ...file,
  id: 'CCCCCCCCCCCCCCCC',
  name: 'loose.txt',
  parent: null,
};

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.getAttribute('aria-label') === label || element.textContent?.trim() === label,
  );

describe('Heimdall downloads', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(api.fetchDownloads).mockResolvedValue([folder, file, rootFile]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <HeimdallDownloadsSection />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    act(() => notifications.clear());
    vi.clearAllMocks();
  });

  it('shows folder counts and links to browse and preview without leaving Heimdall', async () => {
    expect(container.textContent).toContain('1 file · 12 B');
    expect(container.querySelector('[aria-label="Browse Trip photos"]')?.getAttribute('href')).toBe(
      '/downloads/folder/AAAAAAAAAAAAAAAA',
    );

    await act(async () => button('Show files')?.click());

    const preview = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(
      (anchor) => anchor.getAttribute('aria-label') === 'Preview Trip photos/report & final.txt',
    );
    expect(preview?.getAttribute('href')).toBe('/downloads/BBBBBBBBBBBBBBBB/preview');
    expect(preview?.target).toBe('_blank');
    expect(preview?.rel).toContain('noopener');
  });

  it('confirms folder deletion and removes the folder and its indexed contents', async () => {
    await act(async () => button('Delete folder Trip photos')?.click());
    expect(container.textContent).toContain('Delete folder and everything inside it?');
    expect(api.deleteDownload).not.toHaveBeenCalled();

    await act(async () => {
      [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Keep')?.click();
    });
    expect(container.textContent).not.toContain('Delete folder and everything inside it?');

    await act(async () => button('Delete folder Trip photos')?.click());
    await act(async () => {
      [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Delete')?.click();
      await Promise.resolve();
    });

    expect(api.deleteDownload).toHaveBeenCalledWith(folder.id);
    expect(container.querySelectorAll('.file-row__name').length).toBe(1);
    expect(container.textContent).toContain('loose.txt');
  });

  it('keeps the file visible when deletion fails', async () => {
    vi.mocked(api.deleteDownload).mockRejectedValueOnce(new Error('offline'));

    await act(async () => button('Delete loose.txt')?.click());
    await act(async () => {
      [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Delete')?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('loose.txt');
  });
});
