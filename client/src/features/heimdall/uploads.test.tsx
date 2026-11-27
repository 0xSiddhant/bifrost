// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { notifications } from '../../core/notify';
import { SECTIONS } from './sections';
import * as api from './api';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    fetchUploads: vi.fn(),
    publishUpload: vi.fn(async () => ({ finalName: 'report.pdf', renamed: false })),
    deleteUpload: vi.fn(async () => null),
  };
});

const rowNames = () =>
  [...document.querySelectorAll('.file-row__name')].map((element) => element.textContent);

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.getAttribute('aria-label') === label,
  );

describe('Heimdall staged uploads', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(api.fetchUploads).mockResolvedValue({
      total: 1,
      items: [{ name: 'report & final.txt', size: 12, mtime: 1 }],
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const Uploads = SECTIONS.find((section) => section.id === 'uploads')?.Component;
    if (!Uploads) throw new Error('Heimdall uploads section missing');
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Uploads onLock={() => {}} />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    act(() => notifications.clear());
    vi.clearAllMocks();
  });

  it('opens the existing staged-file preview in a separate tab', () => {
    const link = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(
      (element) => element.getAttribute('aria-label') === 'Preview report & final.txt',
    );
    expect(link?.getAttribute('href')).toBe('/upload/report%20%26%20final.txt/preview');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
  });

  it('moves a staged file into Downloads and removes its row', async () => {
    await act(async () => button('Move report & final.txt to Downloads')?.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.publishUpload).toHaveBeenCalledWith('report & final.txt');
    expect(rowNames()).toEqual([]);
    expect(notifications.getSnapshot().visible[0]?.message).toContain('Moved report & final.txt');
  });

  it('confirms deletion before removing the staged file', async () => {
    await act(async () => button('Delete report & final.txt')?.click());
    expect(container.textContent).toContain('Delete this staged file?');
    expect(api.deleteUpload).not.toHaveBeenCalled();

    await act(async () => {
      [...container.querySelectorAll('button')].find((item) => item.textContent === 'Keep')?.click();
    });
    expect(container.textContent).not.toContain('Delete this staged file?');
    expect(rowNames()).toHaveLength(1);

    await act(async () => button('Delete report & final.txt')?.click());
    await act(async () => {
      [...container.querySelectorAll('button')].find((item) => item.textContent === 'Delete')?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.deleteUpload).toHaveBeenCalledWith('report & final.txt');
    expect(rowNames()).toEqual([]);
  });

  it('keeps the row and surfaces an error when moving fails', async () => {
    vi.mocked(api.publishUpload).mockRejectedValueOnce(new Error('offline'));

    await act(async () => button('Move report & final.txt to Downloads')?.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(rowNames()).toHaveLength(1);
    expect(notifications.getSnapshot().visible[0]?.message).toContain(
      'Could not move report & final.txt',
    );
  });
});
