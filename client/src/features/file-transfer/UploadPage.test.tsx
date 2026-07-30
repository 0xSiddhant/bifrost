// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../core/api';
import { notifications } from '../../core/notify';
import { UploadPage } from './UploadPage';
import * as api from './api';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    fetchUploadConfig: vi.fn(async () => ({
      maxUploadSizeMb: 10,
      maxFilesPerUpload: 5,
      blockedExtensions: ['.exe'],
    })),
    uploadFile: vi.fn(() => ({ promise: Promise.resolve('report.pdf'), cancel: vi.fn() })),
    publishUpload: vi.fn(async () => ({ finalName: 'report.pdf', renamed: false })),
    deleteUpload: vi.fn(async () => null),
  };
});

const cards = () => [...document.querySelectorAll('.staged')];
const byText = (text: string) =>
  [...document.querySelectorAll('button, a')].find((el) => el.textContent?.includes(text)) as
    | HTMLElement
    | undefined;
const byLabel = (label: string) =>
  document.querySelector<HTMLElement>(`[aria-label="${label}"]`) ?? undefined;

describe('UploadPage staging actions', () => {
  let container: HTMLDivElement;
  let root: Root;

  /** Put one finished upload on the page. */
  async function stageOneFile() {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['payload'], 'report.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Let the upload promise and its follow-up state update settle.
    await act(async () => {
      await Promise.resolve();
    });
  }

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/upload']}>
          <UploadPage />
        </MemoryRouter>,
      );
    });
    await stageOneFile();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    act(() => notifications.clear());
    vi.clearAllMocks();
  });

  it('offers all four actions once a file is staged', () => {
    expect(cards()).toHaveLength(1);
    expect(byText('Move')).toBeTruthy();
    expect(byLabel('Preview report.pdf')).toBeTruthy();
    expect(byLabel('Rename report.pdf')).toBeTruthy();
    expect(byLabel('Delete report.pdf')).toBeTruthy();
  });

  it('runs moving → moved → gone, removing the card on animationend', async () => {
    await act(async () => byText('Move')?.click());

    // The confirmation is on screen and the exit animation is running…
    const card = cards()[0];
    expect(card?.className).toContain('staged--leaving');
    expect(card?.textContent).toContain('you will find this in Receive');

    // …and nothing removes it until that animation actually ends. A timer here
    // would keep counting in a backgrounded tab; the animation does not.
    expect(cards()).toHaveLength(1);

    await act(async () => {
      // Both spellings on purpose: React picks which native name to listen
      // for from `window.AnimationEvent`, which jsdom does not implement, so
      // in this environment it is listening for the webkit-prefixed one. A
      // real browser fires the unprefixed name.
      card?.dispatchEvent(new Event('animationend', { bubbles: true }));
      card?.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }));
    });
    expect(cards()).toHaveLength(0);
  });

  it('hides every action while the move is in flight, so delete cannot race it', async () => {
    let resolvePublish: (value: api.StagedFileResult) => void = () => {};
    vi.mocked(api.publishUpload).mockReturnValueOnce(
      new Promise<api.StagedFileResult>((resolve) => {
        resolvePublish = resolve;
      }),
    );

    await act(async () => byText('Move')?.click());

    expect(cards()[0]?.textContent).toContain('moving…');
    expect(byLabel('Delete report.pdf')).toBeUndefined();
    expect(byText('Move')).toBeUndefined();

    await act(async () => {
      resolvePublish({ finalName: 'report.pdf', renamed: false });
    });
    expect(cards()[0]?.className).toContain('staged--leaving');
  });

  it('says where a renamed file actually landed', async () => {
    vi.mocked(api.publishUpload).mockResolvedValueOnce({
      finalName: 'report-1.pdf',
      renamed: true,
    });

    await act(async () => byText('Move')?.click());
    expect(cards()[0]?.textContent).toContain('saved as report-1.pdf');
  });

  // Criterion 12: a stale card, not an unhandled rejection.
  it('drops the card and explains when the file is already gone (404)', async () => {
    vi.mocked(api.publishUpload).mockRejectedValueOnce(new ApiError(404, 'gone', 'NOT_FOUND'));

    await act(async () => byText('Move')?.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(cards()).toHaveLength(0);
    expect(notifications.getSnapshot().visible[0]?.message).toContain('no longer staged');
  });

  it('returns the card to its actions when the move is already running (409)', async () => {
    vi.mocked(api.publishUpload).mockRejectedValueOnce(
      new ApiError(409, 'already moving', 'ALREADY_MOVING'),
    );

    await act(async () => byText('Move')?.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(cards()).toHaveLength(1);
    expect(byText('Move')).toBeTruthy();
    expect(notifications.getSnapshot().visible[0]?.message).toContain('already on its way');
  });

  it('asks before deleting, naming the file, and only then deletes', async () => {
    await act(async () => byLabel('Delete report.pdf')?.click());

    expect(container.textContent).toContain('Delete');
    expect(container.querySelector('.staged__confirm')?.textContent).toContain('report.pdf');
    expect(api.deleteUpload).not.toHaveBeenCalled();

    await act(async () => byText('Keep')?.click());
    expect(container.querySelector('.staged__confirm')).toBeNull();
    expect(cards()).toHaveLength(1);

    await act(async () => byLabel('Delete report.pdf')?.click());
    await act(async () => byText('Delete')?.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.deleteUpload).toHaveBeenCalledWith('report.pdf');
    expect(cards()).toHaveLength(0);
  });

  // Criterion 3, the hard half: a *frozen* tab never resumes its paused CSS
  // animation, so `animationend` can simply never arrive. Verified live — the
  // card sat there indefinitely — hence the sweep on return.
  it('clears a confirmation that outlived its animation when the tab comes back', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => byText('Move')?.click());
      expect(cards()).toHaveLength(1);

      // Away for longer than the exit animation, with no animationend.
      vi.setSystemTime(Date.now() + 10_000);
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(cards()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a confirmation alone when the tab returns mid-animation', async () => {
    await act(async () => byText('Move')?.click());
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Glanced away and back: the animation is still running, so nothing here
    // may cut the confirmation short.
    expect(cards()).toHaveLength(1);
  });

  // Criterion 20: the queue is state, not storage.
  it('keeps the queue in component state — a remount starts empty', async () => {
    expect(cards()).toHaveLength(1);
    expect(window.sessionStorage.length).toBe(0);

    // A real refresh is a fresh root, not a re-render of the same tree.
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/upload']}>
          <UploadPage />
        </MemoryRouter>,
      );
    });
    expect(cards()).toHaveLength(0);
  });
});
