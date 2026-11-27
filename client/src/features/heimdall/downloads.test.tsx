// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { notifications } from '../../core/notify';
import { ApiError, type DownloadEntry } from '../../core/api';
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

const setSearch = (container: HTMLDivElement, value: string) => {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error('Downloads search input is missing');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

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
    expect(container.textContent).toContain('Delete 1 listed file?');
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

    expect(api.deleteDownload).toHaveBeenCalledWith(folder.id, {
      name: folder.name,
      parent: folder.parent,
      ext: folder.ext,
      type: 'folder',
      size: folder.size,
      mtime: folder.mtime,
      children: [{ name: file.name, size: file.size, mtime: file.mtime }],
    });
    expect(container.querySelectorAll('.file-row__name').length).toBe(1);
    expect(container.textContent).toContain('loose.txt');
  });

  it('shows all files when the folder name matches and allows search expansion to be collapsed', async () => {
    await act(async () => setSearch(container, 'Trip'));
    await act(async () => button('Show files')?.click());
    expect(container.textContent).toContain('report & final.txt');

    await act(async () => setSearch(container, 'report'));
    expect(container.textContent).toContain('report & final.txt');
    await act(async () => button('Hide files')?.click());
    expect(container.textContent).not.toContain('report & final.txt');
    await act(async () => button('Show files')?.click());
    expect(container.textContent).toContain('report & final.txt');
  });

  it('keeps the file visible when deletion fails', async () => {
    vi.mocked(api.deleteDownload).mockRejectedValueOnce(new Error('offline'));

    await act(async () => button('Delete loose.txt')?.click());
    await act(async () => {
      button('Confirm delete loose.txt')?.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(api.deleteDownload).toHaveBeenCalledWith(rootFile.id, {
      name: rootFile.name,
      parent: rootFile.parent,
      ext: rootFile.ext,
      type: 'file',
      size: rootFile.size,
      mtime: rootFile.mtime,
      children: [],
    });
    expect(container.textContent).toContain('loose.txt');
  });

  it('removes a stale row after a 404 response', async () => {
    vi.mocked(api.deleteDownload).mockRejectedValueOnce(new ApiError(404, 'missing', 'NOT_FOUND'));

    await act(async () => button('Delete loose.txt')?.click());
    await act(async () => {
      button('Confirm delete loose.txt')?.click();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('loose.txt');
  });

  it('refreshes the listing after a 409 conflict', async () => {
    vi.mocked(api.deleteDownload).mockRejectedValueOnce(
      new ApiError(409, 'changed', 'DOWNLOAD_CHANGED'),
    );
    vi.mocked(api.fetchDownloads).mockResolvedValueOnce([folder, rootFile]);

    await act(async () => button('Delete loose.txt')?.click());
    await act(async () => {
      button('Confirm delete loose.txt')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(api.fetchDownloads).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('report & final.txt');
  });

  it('ignores a refresh response that started before a successful delete', async () => {
    let resolveRefresh!: (entries: DownloadEntry[]) => void;
    vi.mocked(api.fetchDownloads).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    await act(async () => button('Refresh')?.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.fetchDownloads).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('loose.txt');

    await act(async () => button('Delete loose.txt')?.click());
    await act(async () => {
      button('Confirm delete loose.txt')?.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(api.deleteDownload).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('loose.txt');

    await act(async () => {
      resolveRefresh([folder, file, rootFile]);
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('loose.txt');
    expect(container.textContent).not.toContain('Loading Downloads…');
  });
});
