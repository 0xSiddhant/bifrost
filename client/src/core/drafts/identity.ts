import type { DraftStorage } from './storage';

/**
 * A stable id per browser tab (PLAN-43), so each tab's drafts have keys of
 * their own.
 *
 * The id lives in `sessionStorage`, which a tab keeps across reloads, a Back
 * navigation and the browser's "reopen closed tab". But a duplicated tab, or
 * one opened with `window.open` (the spike saw this in Chromium), starts with
 * a **copy** of it, so two live tabs can hold the same id. Before a tab reuses
 * an id it found there, it asks the other tabs on a `BroadcastChannel`
 * whether one of them is live under that id; an answer means "take a new
 * one". The tab asking always yields, so the tab that has been editing keeps
 * its drafts. A fresh random id needs no question. Without a channel the
 * question cannot be asked, so a stored id is never reused: a new one is
 * taken and the old drafts stay untouched under the old one.
 *
 * Nothing reads or writes a draft until the identity is ready.
 */

export const TAB_ID_KEY = 'bifrost.tab.id';
export const CHANNEL_NAME = 'bifrost.drafts';
/** How long a tab waits for a live twin to answer before reusing a stored id. */
export const HANDSHAKE_MS = 250;
/** After telling a twin to yield, rewrite our own drafts once it can no longer be writing. */
export const COLLISION_REFLUSH_MS = 800;

export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export interface IdentityDeps {
  session: DraftStorage | null;
  openChannel: () => ChannelLike | null;
  newId: () => string;
  setTimer: (fn: () => void, ms: number) => unknown;
}

type Message = { t: 'probe'; tab: string; from: string } | { t: 'taken'; tab: string; to: string };

function asMessage(data: unknown): Message | null {
  const message = data as Partial<Message> | null;
  if (!message || typeof message !== 'object' || typeof message.tab !== 'string') return null;
  if (message.t === 'probe' && typeof (message as { from?: unknown }).from === 'string')
    return message as Message;
  if (message.t === 'taken' && typeof (message as { to?: unknown }).to === 'string')
    return message as Message;
  return null;
}

export type IdentityEvent =
  /** The identity became usable (the first time). */
  | 'ready'
  /** This tab gave up its id to a live twin and now has a new one. */
  | 'changed'
  /** A twin was told to yield; rewrite our drafts in case it wrote first. */
  | 'reflush';

export class TabIdentity {
  /** This page lifetime: a reload is a new instance under the same tab id. */
  readonly instance: string;
  tab = '';
  ready = false;
  /** How the id was settled, for tests and logs. */
  origin: 'fresh' | 'reused' | 'yielded' | 'no-channel' = 'fresh';
  private channel: ChannelLike | null = null;
  /** Set once the page has left (`pagehide`): it no longer speaks for its id. */
  private suspended = false;
  private readonly listeners = new Set<(event: IdentityEvent) => void>();

  constructor(private readonly deps: IdentityDeps) {
    this.instance = deps.newId();
  }

  on(listener: (event: IdentityEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: IdentityEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  start(): void {
    let stored: string | null = null;
    try {
      stored = this.deps.session?.get(TAB_ID_KEY) ?? null;
    } catch {
      // Deliberately silent: no sessionStorage means a new id per page load,
      // which costs only the same-tab restore, and the hook reports that.
      stored = null;
    }
    try {
      this.channel = this.deps.openChannel();
    } catch {
      this.channel = null;
    }
    if (this.channel) this.channel.onmessage = (event) => this.onMessage(event.data);

    if (!stored) {
      this.adopt(this.deps.newId(), 'fresh');
      this.settle();
      return;
    }
    if (!this.channel) {
      // Uniqueness cannot be checked: never reuse a possibly copied id.
      this.adopt(this.deps.newId(), 'no-channel');
      this.settle();
      return;
    }
    this.tab = stored;
    this.origin = 'reused';
    this.probe();
    this.deps.setTimer(() => this.settle(), HANDSHAKE_MS);
  }

  /**
   * The page is going (`pagehide`): stop answering for the id. A reload's new
   * document asks for the same id while, in WebKit, the old one can still
   * hear it; an answer then would make the reloaded tab give up its own id
   * and leave its drafts under the old one (PR #122's CI, webkit-mobile).
   */
  suspend(): void {
    this.suspended = true;
  }

  /** Back from the back/forward cache: speak for the id again, after asking whether a twin took it. */
  resume(): void {
    this.suspended = false;
    this.probe();
  }

  /** Ask again whether a live twin holds our id (after a back/forward-cache restore). */
  probe(): void {
    this.channel?.postMessage({ t: 'probe', tab: this.tab, from: this.instance } satisfies Message);
  }

  private adopt(tab: string, origin: TabIdentity['origin']): void {
    this.tab = tab;
    this.origin = origin;
    try {
      this.deps.session?.set(TAB_ID_KEY, tab);
    } catch {
      // Deliberately silent: the id still holds for this page lifetime.
    }
  }

  private settle(): void {
    if (this.ready) return;
    this.ready = true;
    this.emit('ready');
  }

  private onMessage(data: unknown): void {
    const message = asMessage(data);
    if (!message || message.tab !== this.tab || this.suspended) return;
    if (message.t === 'probe') {
      if (message.from === this.instance) return;
      // A live tab keeps its id. Two tabs both still asking (opened together)
      // settle it by instance order, so exactly one of them yields.
      if (this.ready || this.instance < message.from) {
        this.channel?.postMessage({
          t: 'taken',
          tab: this.tab,
          to: message.from,
        } satisfies Message);
        if (this.ready) this.deps.setTimer(() => this.emit('reflush'), COLLISION_REFLUSH_MS);
      }
      return;
    }
    if (message.to !== this.instance) return;
    // A live twin holds this id: take a new one. If we were already writing
    // (its answer came late), our drafts move with us on the next flush.
    const wasReady = this.ready;
    this.adopt(this.deps.newId(), 'yielded');
    if (wasReady) this.emit('changed');
    else this.settle();
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
  }
}
