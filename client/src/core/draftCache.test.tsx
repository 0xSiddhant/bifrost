// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { showsRestore, useDraftCache, type ScratchDraft } from './draftCache';
import { takeLeftOpen } from './draftReturn';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const OLD: ScratchDraft = { title: 'Older', text: '{"old":true}', savedAt: 1 };

interface Props {
  text: string;
  offered?: ScratchDraft | null;
  isScratch?: boolean;
  returnId?: string;
}

describe('useDraftCache', () => {
  let container: HTMLDivElement;
  let root: Root;
  let stored: ScratchDraft | null;
  const save = vi.fn((draft: ScratchDraft) => {
    stored = draft;
  });
  const clear = vi.fn(() => {
    stored = null;
  });

  function Editor({ text, offered = null, isScratch = true, returnId }: Props) {
    useDraftCache({
      isScratch,
      title: 'Now',
      text,
      blank: text.trim() === '',
      offered,
      save,
      clear,
      returnId,
    });
    return null;
  }

  const render = async (props: Props) => {
    await act(async () => {
      root.render(<Editor {...props} />);
    });
  };

  const settle = async () => {
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.clearAllMocks();
    stored = OLD;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('caches what is typed, replacing the older draft', async () => {
    await render({ text: '', offered: OLD });
    await render({ text: '{"new":1}', offered: OLD });
    await settle();
    expect(stored?.text).toBe('{"new":1}');
  });

  it('puts the offered draft back when the buffer is emptied again', async () => {
    await render({ text: '{"new":1}', offered: OLD });
    await settle();
    await render({ text: '', offered: OLD });
    await settle();
    expect(stored).toEqual(OLD);
  });

  it('clears the cache when the buffer is emptied and nothing is on offer', async () => {
    await render({ text: '{"new":1}' });
    await settle();
    await render({ text: '   ' });
    await settle();
    expect(stored).toBeNull();
  });

  it('flushes the buffer on leaving, inside the debounce window', async () => {
    await render({ text: '{"last":1}', offered: OLD, returnId: 'cache-a' });
    await act(async () => root.unmount());
    expect(stored?.text).toBe('{"last":1}');
    expect(takeLeftOpen('cache-a')).toBe(true);
    root = createRoot(container);
  });

  it('flushes on a page unload too, without marking a return', async () => {
    await render({ text: '{"reloaded":1}', offered: OLD, returnId: 'cache-c' });
    window.dispatchEvent(new Event('pagehide'));
    expect(stored?.text).toBe('{"reloaded":1}');
    expect(takeLeftOpen('cache-c')).toBe(false);
  });

  it('keeps the offered draft when left blank inside the debounce window', async () => {
    await render({ text: '{"new":1}', offered: OLD, returnId: 'cache-b' });
    await settle();
    await render({ text: '', offered: OLD, returnId: 'cache-b' });
    await act(async () => root.unmount());
    expect(stored).toEqual(OLD);
    expect(takeLeftOpen('cache-b')).toBe(false);
    root = createRoot(container);
  });

  it('touches nothing for a saved document', async () => {
    await render({ text: '{"saved":1}', isScratch: false });
    await settle();
    await act(async () => root.unmount());
    expect(save).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});

describe('showsRestore', () => {
  it('shows only while a draft is on offer and the buffer is blank', () => {
    expect(showsRestore(OLD, true)).toBe(true);
    expect(showsRestore(OLD, false)).toBe(false);
    expect(showsRestore(null, true)).toBe(false);
  });
});
