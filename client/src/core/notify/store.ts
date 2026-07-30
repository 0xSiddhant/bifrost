/**
 * The notification store (PLAN-17a).
 *
 * `core/ui/Toast` is a presentational div: it sits *in* a page's layout and
 * lives as long as that page's state says so. This is the other thing — a
 * single global stack, outside any route, that any code can push to, including
 * code that is not a React component (the SSE layer in 17b needs exactly that).
 *
 * All the interesting behaviour is here rather than in the component, because
 * timers, caps and eviction are where the bugs live and none of them need a
 * DOM to be tested.
 */

export type NotifyKind = 'info' | 'ok' | 'error';

export interface NotifyOptions {
  /** ms until auto-dismiss; `0` stays until dismissed. Errors default to 0. */
  timeout?: number;
  /** Repeats under the same key collapse into one entry carrying a counter. */
  dedupeKey?: string;
  /** Optional bold line above the message. */
  title?: string;
  /** Called once, whenever the entry leaves the stack (any reason). */
  onDismiss?: () => void;
}

export interface Notification {
  id: number;
  kind: NotifyKind;
  message: string;
  title?: string;
  /** 1, or N once repeats have collapsed under a `dedupeKey`. */
  count: number;
  /** 0 = no auto-dismiss. */
  timeout: number;
  /** Bumped on every timer (re)start so the progress animation remounts. */
  epoch: number;
  paused: boolean;
}

export interface NotifyState {
  /** Newest first — the stack renders top-down. */
  visible: Notification[];
  /** Entries held back by the cap. */
  overflow: number;
  /** Errors currently in the stack, visible or not. */
  errorCount: number;
}

/** A bulk move of 20 files must not paper over the screen. */
export const MAX_VISIBLE = 4;
/**
 * Errors do not auto-dismiss, so without a cap of their own four unresolved
 * ones would fill the stack permanently and every later success would vanish
 * behind an overflow count. Holding errors one below MAX_VISIBLE means any
 * four newest entries contain at most three errors — a transient notification
 * always has a slot, by arithmetic rather than by a special case.
 */
export const MAX_ERRORS = MAX_VISIBLE - 1;

export const DEFAULT_TIMEOUT_MS = 5_000;

interface Timer {
  handle: number;
  /** Wall-clock ms at which this entry expires; null while paused. */
  expiresAt: number | null;
  /** ms left when paused. */
  remaining: number;
}

const EMPTY: NotifyState = { visible: [], overflow: 0, errorCount: 0 };

export class NotificationStore {
  /** Newest first. */
  private entries: Notification[] = [];
  private readonly timers = new Map<number, Timer>();
  private readonly onDismissHandlers = new Map<number, () => void>();
  private readonly dedupeKeys = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private snapshot: NotifyState = EMPTY;
  private nextId = 1;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable between changes — `useSyncExternalStore` compares by identity. */
  getSnapshot = (): NotifyState => this.snapshot;

  push(kind: NotifyKind, message: string, options: NotifyOptions = {}): number {
    const existingId =
      options.dedupeKey !== undefined ? this.dedupeKeys.get(options.dedupeKey) : undefined;
    if (existingId !== undefined) {
      return this.collapse(existingId, message, options);
    }

    const id = this.nextId++;
    const timeout = options.timeout ?? (kind === 'error' ? 0 : DEFAULT_TIMEOUT_MS);
    this.entries.unshift({
      id,
      kind,
      message,
      title: options.title,
      count: 1,
      timeout,
      epoch: 0,
      paused: false,
    });
    if (options.dedupeKey !== undefined) this.dedupeKeys.set(options.dedupeKey, id);
    if (options.onDismiss) this.onDismissHandlers.set(id, options.onDismiss);
    this.evictExcessErrors(id);
    this.arm(id, timeout);
    this.publish();
    return id;
  }

  dismiss(id: number): void {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    this.remove(index);
    this.publish();
  }

  /**
   * Dismiss whatever is standing under a dedupe key, wherever it came from.
   * Answers `true` if there was something to clear — the caller that raised
   * "could not refresh" is rarely the one still mounted when it recovers, so
   * clearing by key rather than by a captured id is what keeps a stale error
   * from outliving the condition it describes.
   */
  dismissKey(dedupeKey: string): boolean {
    const id = this.dedupeKeys.get(dedupeKey);
    if (id === undefined) return false;
    this.dismiss(id);
    return true;
  }

  /** The escape hatch when a run of failures has stacked up. */
  dismissErrors(): void {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index]?.kind === 'error') this.remove(index);
    }
    this.publish();
  }

  /**
   * Hover/focus pauses the countdown. Dismissing a banner while someone is
   * still reading it is the classic failure of this pattern.
   */
  pause(id: number): void {
    const timer = this.timers.get(id);
    if (!timer || timer.expiresAt === null) return;
    window.clearTimeout(timer.handle);
    timer.remaining = Math.max(0, timer.expiresAt - Date.now());
    timer.expiresAt = null;
    this.patch(id, { paused: true });
  }

  resume(id: number): void {
    const timer = this.timers.get(id);
    if (!timer || timer.expiresAt !== null) return;
    timer.handle = window.setTimeout(() => this.expire(id), timer.remaining);
    timer.expiresAt = Date.now() + timer.remaining;
    this.patch(id, { paused: false });
  }

  /** Test seam — nothing in the app clears the whole stack. */
  clear(): void {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) this.remove(index);
    this.publish();
  }

  private collapse(id: number, message: string, options: NotifyOptions): number {
    const index = this.entries.findIndex((candidate) => candidate.id === id);
    const entry = this.entries[index];
    if (!entry) return id;
    // Latest wording wins: "3 files published" replaces "2 files published".
    // Position is deliberately kept — a repeat must not make the stack jump.
    this.entries[index] = {
      ...entry,
      message,
      title: options.title ?? entry.title,
      count: entry.count + 1,
      epoch: entry.epoch + 1,
      paused: false,
    };
    if (options.onDismiss) this.onDismissHandlers.set(id, options.onDismiss);
    this.arm(id, entry.timeout);
    this.publish();
    return id;
  }

  private arm(id: number, timeout: number): void {
    const existing = this.timers.get(id);
    if (existing) window.clearTimeout(existing.handle);
    if (timeout <= 0) {
      this.timers.delete(id);
      return;
    }
    this.timers.set(id, {
      handle: window.setTimeout(() => this.expire(id), timeout),
      expiresAt: Date.now() + timeout,
      remaining: timeout,
    });
  }

  private expire(id: number): void {
    this.dismiss(id);
  }

  /** Keep the newest errors; the oldest one makes room. */
  private evictExcessErrors(exceptId: number): void {
    let errors = this.entries.filter((entry) => entry.kind === 'error').length;
    for (let index = this.entries.length - 1; index >= 0 && errors > MAX_ERRORS; index -= 1) {
      const entry = this.entries[index];
      if (entry && entry.kind === 'error' && entry.id !== exceptId) {
        this.remove(index);
        errors -= 1;
      }
    }
  }

  private remove(index: number): void {
    const [entry] = this.entries.splice(index, 1);
    if (!entry) return;
    const timer = this.timers.get(entry.id);
    if (timer) window.clearTimeout(timer.handle);
    this.timers.delete(entry.id);
    for (const [key, id] of this.dedupeKeys) {
      if (id === entry.id) this.dedupeKeys.delete(key);
    }
    const handler = this.onDismissHandlers.get(entry.id);
    this.onDismissHandlers.delete(entry.id);
    if (handler) handler();
  }

  private patch(id: number, partial: Partial<Notification>): void {
    const index = this.entries.findIndex((entry) => entry.id === id);
    const entry = this.entries[index];
    if (!entry) return;
    this.entries[index] = { ...entry, ...partial };
    this.publish();
  }

  private publish(): void {
    const visible = this.entries.slice(0, MAX_VISIBLE);
    this.snapshot = {
      visible,
      overflow: this.entries.length - visible.length,
      errorCount: this.entries.filter((entry) => entry.kind === 'error').length,
    };
    for (const listener of this.listeners) listener();
  }
}
