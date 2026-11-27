import { log } from '../log';
import type { CoordBackend } from './coordinator';
import { TabIdentity, CHANNEL_NAME, type ChannelLike, type IdentityEvent } from './identity';
import type { Me, ProtocolContext, SweepFeature } from './protocol';
import {
  LEFT_PREFIX,
  PRUNE_GRACE_MS,
  departureValue,
  leftKey,
  randomId,
  type DraftFeature,
} from './basics';
import {
  browserLocalStorage,
  browserSessionStorage,
  storageErrorReason,
  type DraftStorage,
} from './storage';

/**
 * One tab's draft session (PLAN-43): its identity, its page lifetime in the
 * IndexedDB registry, the flushes that run when the page is hidden or left,
 * the departure marker written last when it is left for good, and the sweep
 * that prunes closed tabs' drafts.
 */

export interface SessionDeps {
  local: DraftStorage;
  session: DraftStorage | null;
  openChannel: () => ChannelLike | null;
  /**
   * The coordination store, or a loader for it: the browser's is loaded on
   * demand, so the first page load carries only the identity and the
   * departure marker, not the transfer and pruning code.
   */
  backend: CoordBackend | null | (() => Promise<CoordBackend | null>);
  now: () => number;
  newId: () => string;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Window/document events; null where there is no window (tests that drive them by hand). */
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null;
}

/** Sweep shortly after something changed, not on every keystroke. */
const SWEEP_DEBOUNCE_MS = 2_000;

export type FlushReason = 'hidden' | 'pagehide' | 'identity';

export class DraftSession {
  readonly identity: TabIdentity;
  private started = false;
  private readonly flushers = new Set<(reason: FlushReason) => void>();
  private readonly subscribers = new Set<() => void>();
  private readonly protectedKeys = new Map<string, number>();
  private readonly sweepFeatures: Partial<Record<DraftFeature, SweepFeature>> = {};
  private coordination: Promise<ProtocolContext | null> | null = null;
  /** The id and lifetime this page last registered, to release when it yields the id. */
  private registeredAs: Me | null = null;
  /** The debounced sweep shortly after a change. */
  private soonTimer: unknown = null;
  /** Sweeps due later (a departed tab's prune grace), earliest armed; none cancels another. */
  private pruneTimer: unknown = null;
  private pruneDue: number[] = [];
  private warned = new Set<string>();
  private detach: () => void = () => undefined;

  constructor(private readonly deps: SessionDeps) {
    this.identity = new TabIdentity({
      session: deps.session,
      openChannel: deps.openChannel,
      newId: deps.newId,
      setTimer: deps.setTimer,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.identity.on((event) => this.onIdentity(event));
    this.identity.start();
    const onPageHide = (event: Event) => this.onPageHide(event as PageTransitionEvent);
    const onPageShow = (event: Event) => {
      // Back from the back/forward cache: this lifetime goes on, but a twin
      // may have taken the id meanwhile, so ask again.
      if ((event as PageTransitionEvent).persisted) this.identity.resume();
    };
    const onStorage = (event: Event) => {
      const { key, newValue } = event as StorageEvent;
      // Another tab left: once its draft can be pruned, look again.
      if (key?.startsWith(LEFT_PREFIX) && newValue) this.requestSweep(PRUNE_GRACE_MS + 1_000);
    };
    // Frozen, discarded-and-restored or busy past the handshake, this tab may
    // have missed a duplicate's question and both now hold one id: ask again
    // on waking. A twin that kept it answers, and this tab takes a new one.
    const recheckIdentity = () => {
      if (this.identity.ready) this.identity.probe();
    };
    const onVisibility = () => {
      // A hidden tab can be discarded without another event: keep what is typed.
      if (this.deps.doc?.visibilityState === 'hidden') this.flush('hidden');
      else recheckIdentity();
    };
    const { target, doc } = this.deps;
    target?.addEventListener('pagehide', onPageHide);
    target?.addEventListener('pageshow', onPageShow);
    target?.addEventListener('storage', onStorage);
    doc?.addEventListener('visibilitychange', onVisibility);
    // Chrome's Page Lifecycle: a frozen tab thawing.
    doc?.addEventListener('resume', recheckIdentity);
    this.detach = () => {
      target?.removeEventListener('pagehide', onPageHide);
      target?.removeEventListener('pageshow', onPageShow);
      target?.removeEventListener('storage', onStorage);
      doc?.removeEventListener('visibilitychange', onVisibility);
      doc?.removeEventListener('resume', recheckIdentity);
    };
  }

  /** Detach every listener (tests; a page never stops its session). */
  stop(): void {
    this.detach();
    this.detach = () => undefined;
    if (this.soonTimer !== null) this.deps.clearTimer(this.soonTimer);
    if (this.pruneTimer !== null) this.deps.clearTimer(this.pruneTimer);
    this.soonTimer = null;
    this.pruneTimer = null;
    this.pruneDue = [];
    this.identity.close();
  }

  get ready(): boolean {
    return this.identity.ready;
  }

  me(): Me | null {
    return this.identity.ready
      ? { tab: this.identity.tab, instance: this.identity.instance }
      : null;
  }

  get local(): DraftStorage {
    return this.deps.local;
  }

  now(): number {
    return this.deps.now();
  }

  /** For `useSyncExternalStore`: readiness and identity changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  registerFlusher(flusher: (reason: FlushReason) => void): () => void {
    this.flushers.add(flusher);
    return () => this.flushers.delete(flusher);
  }

  flush(reason: FlushReason): void {
    for (const flusher of [...this.flushers]) {
      try {
        flusher(reason);
      } catch (error) {
        log.reportError('drafts: a flush failed', error, { module: 'drafts' });
      }
    }
  }

  /** The protocol context once this lifetime is registered, or null when coordination is unavailable. */
  coordinated(): Promise<ProtocolContext | null> {
    if (!this.coordination) return Promise.resolve(null);
    return this.coordination;
  }

  /** Teach the sweep how to validate an editor's records (its codec). */
  registerFeature(feature: DraftFeature, spec: SweepFeature): void {
    this.sweepFeatures[feature] = spec;
  }

  /** A record this tab is offering right now: its own sweep leaves it alone. */
  protect(key: string): () => void {
    this.protectedKeys.set(key, (this.protectedKeys.get(key) ?? 0) + 1);
    return () => {
      const count = (this.protectedKeys.get(key) ?? 1) - 1;
      if (count <= 0) this.protectedKeys.delete(key);
      else this.protectedKeys.set(key, count);
    };
  }

  /**
   * Sweep after `delayMs`. A short request is a debounce (shortly after the
   * last change); a longer one (a departed tab's prune grace) is kept until it
   * has run, whatever is requested meanwhile, so neither kind cancels the other.
   */
  requestSweep(delayMs = SWEEP_DEBOUNCE_MS): void {
    if (delayMs <= SWEEP_DEBOUNCE_MS) {
      if (this.soonTimer !== null) this.deps.clearTimer(this.soonTimer);
      this.soonTimer = this.deps.setTimer(() => {
        this.soonTimer = null;
        void this.sweepNow();
      }, delayMs);
      return;
    }
    const due = this.deps.now() + delayMs;
    // Departures moments apart share one sweep, at the later of their times:
    // run at the earlier one, the later departure would not be prunable yet.
    const near = this.pruneDue.findIndex((at) => Math.abs(at - due) < SWEEP_DEBOUNCE_MS);
    if (near === -1) this.pruneDue.push(due);
    else this.pruneDue[near] = Math.max(this.pruneDue[near] ?? due, due);
    this.armPrune();
  }

  private armPrune(): void {
    if (this.pruneTimer !== null) this.deps.clearTimer(this.pruneTimer);
    this.pruneTimer = null;
    if (this.pruneDue.length === 0) return;
    const next = Math.min(...this.pruneDue);
    this.pruneTimer = this.deps.setTimer(
      () => {
        this.pruneTimer = null;
        const now = this.deps.now();
        this.pruneDue = this.pruneDue.filter((at) => at > now);
        void this.sweepNow();
        this.armPrune();
      },
      Math.max(0, next - this.deps.now()),
    );
  }

  async sweepNow(): Promise<number> {
    const ctx = await this.coordinated();
    const me = this.me();
    if (!ctx || !me) return 0;
    try {
      const { sweep } = await import('./protocol');
      return await sweep(ctx, me, this.sweepFeatures, new Set(this.protectedKeys.keys()));
    } catch (error) {
      this.warnOnce(
        'sweep',
        `drafts: pruning closed tabs' drafts failed (${storageErrorReason(error)})`,
      );
      return 0;
    }
  }

  warnOnce(topic: string, message: string): void {
    if (this.warned.has(topic)) return;
    this.warned.add(topic);
    log.warn(message, { module: 'drafts' });
  }

  private onIdentity(event: IdentityEvent): void {
    if (event === 'reflush') {
      this.flush('identity');
      // A twin that answered late may have registered its lifetime under this
      // id first: put this page's back.
      const me = this.me();
      if (me && this.coordination) void this.reregister(me);
      return;
    }
    if (event === 'changed') {
      // Our drafts move to the new id on this flush; the old id's records
      // belong to the twin that kept it, and so does its registry entry.
      this.flush('identity');
      const former = this.registeredAs;
      const previous = this.coordination;
      if (former && previous && former.tab !== this.identity.tab) {
        void previous.then(async (ctx) => {
          if (!ctx) return;
          const { releaseLifetime } = await import('./protocol');
          await releaseLifetime(ctx, former).catch(() => {
            // The twin re-registers itself after it told this page to yield.
          });
        });
      }
    }
    // Ready or changed: this tab's earlier departure (a reload) no longer
    // counts, even where IndexedDB is missing and nothing is registered.
    const me = this.me();
    if (!me) return;
    try {
      this.deps.local.remove(leftKey(me.tab));
    } catch {
      // Reported by the hook's own reads and writes, which hit the same storage.
    }
    this.coordination = this.register(me);
    for (const subscriber of [...this.subscribers]) subscriber();
  }

  private async register(me: Me): Promise<ProtocolContext | null> {
    let backend: CoordBackend | null;
    try {
      backend =
        typeof this.deps.backend === 'function' ? await this.deps.backend() : this.deps.backend;
    } catch (error) {
      this.warnOnce(
        'load',
        `drafts: could not load cross-tab draft recovery (${storageErrorReason(error)})`,
      );
      return null;
    }
    if (!backend) {
      this.warnOnce('no-idb', 'drafts: no IndexedDB here, so cross-tab draft recovery is off');
      return null;
    }
    const ctx: ProtocolContext = { local: this.deps.local, backend, now: this.deps.now };
    try {
      const { registerLifetime } = await import('./protocol');
      // Skipped when this page yielded the id while loading: it is the twin's.
      if (await registerLifetime(ctx, me, () => this.identity.tab === me.tab))
        this.registeredAs = me;
    } catch (error) {
      this.warnOnce(
        'register',
        `drafts: could not register this tab (${storageErrorReason(error)}), so cross-tab draft recovery is off`,
      );
      return null;
    }
    this.requestSweep();
    return ctx;
  }

  private async reregister(me: Me): Promise<void> {
    const ctx = await this.coordinated();
    if (!ctx) return;
    try {
      const { registerLifetime } = await import('./protocol');
      if (await registerLifetime(ctx, me, () => this.identity.tab === me.tab))
        this.registeredAs = me;
    } catch (error) {
      this.warnOnce(
        'register',
        `drafts: could not register this tab (${storageErrorReason(error)})`,
      );
    }
  }

  private onPageHide(event: PageTransitionEvent): void {
    this.flush('pagehide');
    // Leaving (or frozen in the back/forward cache): this page no longer
    // answers for the id, so a reload's new document keeps it.
    this.identity.suspend();
    // Kept in the back/forward cache: not leaving, so no departure.
    if (event.persisted) return;
    const me = this.me();
    if (!me) return;
    try {
      this.deps.local.set(leftKey(me.tab), departureValue(me.instance, this.deps.now()));
    } catch (error) {
      // Without a marker this tab is never known closed: its drafts stay put.
      this.warnOnce(
        'departure',
        `drafts: could not record this tab leaving (${storageErrorReason(error)})`,
      );
    }
  }
}

function openBroadcastChannel(): ChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME) as unknown as ChannelLike;
}

export function browserSessionDeps(): SessionDeps {
  return {
    local: browserLocalStorage(),
    session: browserSessionStorage(),
    openChannel: openBroadcastChannel,
    backend: async () => (await import('./coordinator')).idbBackend(),
    now: () => Date.now(),
    newId: randomId,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    target: window,
    doc: document,
  };
}

let current: DraftSession | null = null;

/** This tab's session, started on first use. */
export function draftSession(): DraftSession {
  if (!current) {
    current = new DraftSession(browserSessionDeps());
    current.start();
  }
  return current;
}

/** Start early (from `main.tsx`), so the duplicate-tab handshake overlaps the page's own load. */
export function startDraftSession(): void {
  draftSession();
}

/** Tests: install a session of their own (or clear it to get a fresh browser one). */
export function setDraftSessionForTests(session: DraftSession | null): void {
  current = session;
}
