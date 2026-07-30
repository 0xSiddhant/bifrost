// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TIMEOUT_MS, MAX_ERRORS, MAX_VISIBLE, NotificationStore } from './store';

describe('NotificationStore', () => {
  let store: NotificationStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new NotificationStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const messages = () => store.getSnapshot().visible.map((entry) => entry.message);

  it('auto-dismisses transient kinds on their timer', () => {
    store.push('ok', 'saved');
    expect(messages()).toEqual(['saved']);

    vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS - 1);
    expect(messages()).toEqual(['saved']);

    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it('never auto-dismisses an error', () => {
    store.push('error', 'upload failed');
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(messages()).toEqual(['upload failed']);
    expect(store.getSnapshot().visible[0]?.timeout).toBe(0);
  });

  it('pauses and resumes the countdown, keeping the time left', () => {
    const id = store.push('info', 'copied', { timeout: 1000 });

    vi.advanceTimersByTime(600);
    store.pause(id);
    expect(store.getSnapshot().visible[0]?.paused).toBe(true);

    // Hovering for an hour must not consume the remaining 400ms.
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(messages()).toEqual(['copied']);

    store.resume(id);
    expect(store.getSnapshot().visible[0]?.paused).toBe(false);
    vi.advanceTimersByTime(399);
    expect(messages()).toEqual(['copied']);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it('collapses repeats under a dedupeKey into one counted entry', () => {
    store.push('ok', '1 file published', { dedupeKey: 'published' });
    store.push('ok', '2 files published', { dedupeKey: 'published' });
    store.push('ok', '3 files published', { dedupeKey: 'published' });

    const { visible } = store.getSnapshot();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.message).toBe('3 files published');
    expect(visible[0]?.count).toBe(3);
    // Epoch bumps so the progress bar restarts rather than finishing early.
    expect(visible[0]?.epoch).toBe(2);
  });

  it('restarts the timer on every repeat', () => {
    store.push('ok', 'first', { dedupeKey: 'k', timeout: 1000 });
    vi.advanceTimersByTime(900);
    store.push('ok', 'second', { dedupeKey: 'k', timeout: 1000 });

    vi.advanceTimersByTime(900);
    expect(messages()).toEqual(['second']);
    vi.advanceTimersByTime(100);
    expect(messages()).toEqual([]);
  });

  it('frees the dedupe key once the entry is gone, so a later repeat is new', () => {
    const first = store.push('error', 'boom', { dedupeKey: 'k' });
    store.dismiss(first);
    const second = store.push('error', 'boom', { dedupeKey: 'k' });

    expect(second).not.toBe(first);
    expect(store.getSnapshot().visible[0]?.count).toBe(1);
  });

  it('caps the visible stack and reports the overflow', () => {
    for (let index = 1; index <= MAX_VISIBLE + 2; index += 1) {
      store.push('info', `note ${index}`);
    }
    const { visible, overflow } = store.getSnapshot();

    expect(visible).toHaveLength(MAX_VISIBLE);
    // Newest on top.
    expect(visible[0]?.message).toBe(`note ${MAX_VISIBLE + 2}`);
    expect(overflow).toBe(2);
  });

  it('evicts the oldest error rather than letting errors fill the stack', () => {
    for (let index = 1; index <= MAX_ERRORS + 1; index += 1) {
      store.push('error', `error ${index}`);
    }
    const { visible, errorCount, overflow } = store.getSnapshot();

    expect(errorCount).toBe(MAX_ERRORS);
    expect(overflow).toBe(0);
    expect(visible.map((entry) => entry.message)).not.toContain('error 1');
  });

  // Criterion 21: undismissed errors must never hide a later success.
  it('keeps a slot for a transient notification behind a full error stack', () => {
    for (let index = 1; index <= 4; index += 1) store.push('error', `error ${index}`);
    store.push('ok', 'file published');

    const { visible, overflow } = store.getSnapshot();
    expect(visible).toHaveLength(MAX_VISIBLE);
    expect(visible[0]?.message).toBe('file published');
    expect(overflow).toBe(0);
  });

  it('dismisses every error at once, leaving transient entries alone', () => {
    store.push('error', 'error a');
    store.push('ok', 'all good');
    store.push('error', 'error b');

    store.dismissErrors();

    expect(messages()).toEqual(['all good']);
    expect(store.getSnapshot().errorCount).toBe(0);
  });

  it('runs onDismiss exactly once, however the entry leaves', () => {
    const onManual = vi.fn();
    const onTimer = vi.fn();
    const onEvicted = vi.fn();

    // Dismissed by hand, twice — the second call must find nothing to do.
    const manual = store.push('error', 'manual', { onDismiss: onManual });
    store.dismiss(manual);
    store.dismiss(manual);

    // Dismissed by its own timer.
    store.push('ok', 'timer', { onDismiss: onTimer, timeout: 500 });
    vi.advanceTimersByTime(500);

    // Dismissed by the error cap making room for newer errors.
    store.push('error', 'evicted', { onDismiss: onEvicted });
    for (let index = 0; index < MAX_ERRORS; index += 1) store.push('error', `filler ${index}`);

    expect(onManual).toHaveBeenCalledTimes(1);
    expect(onTimer).toHaveBeenCalledTimes(1);
    expect(onEvicted).toHaveBeenCalledTimes(1);
  });

  it('dismisses by dedupe key, and says whether there was anything to clear', () => {
    store.push('error', 'listing stale', { dedupeKey: 'listing' });

    expect(store.dismissKey('listing')).toBe(true);
    expect(messages()).toEqual([]);
    // The recovering caller is often not the one that raised it, so a second
    // clear must be a quiet no-op rather than a false "it recovered".
    expect(store.dismissKey('listing')).toBe(false);
    expect(store.dismissKey('never-used')).toBe(false);
  });

  it('hands out a stable id for a deduped entry, so callers can dismiss it', () => {
    const first = store.push('error', 'listing stale', { dedupeKey: 'listing' });
    const second = store.push('error', 'listing stale', { dedupeKey: 'listing' });
    expect(second).toBe(first);

    store.dismiss(second);
    expect(messages()).toEqual([]);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.push('info', 'one');
    expect(listener).toHaveBeenCalledTimes(1);
    // Same snapshot object until something changes — useSyncExternalStore
    // compares by identity and would loop forever otherwise.
    expect(store.getSnapshot()).toBe(store.getSnapshot());

    unsubscribe();
    store.push('info', 'two');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
