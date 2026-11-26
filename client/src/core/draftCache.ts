import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { log } from './log';
import {
  acceptLegacy,
  acceptOffer,
  findLegacy,
  findOffer,
  type LegacyParse,
} from './drafts/protocol';
import {
  SCRATCH,
  makeEnvelope,
  parseEnvelope,
  recordKey,
  type DraftCodec,
  type DraftEnvelope,
  type DraftFeature,
} from './drafts/records';
import { draftSession } from './drafts/session';
import { storageErrorReason } from './drafts/storage';

/**
 * Keeps an Ollivanders editor's unsaved work in this browser, per tab
 * (PLAN-43). The rules:
 *
 * - **One record per tab, editor and workspace.** A workspace is the scratch
 *   editor, a saved document (by id) or, for Variant, the tab's whole
 *   workbench. Two tabs on the same editor never write the same key, and
 *   saving, clearing or discarding touches only this tab's record for the
 *   workspace on screen.
 * - **The record mirrors the buffer** on a 500 ms debounce: content worth
 *   keeping (`keep`) is written, a buffer with nothing worth keeping removes
 *   the record. Hiding or leaving the page, unmounting and switching workspace
 *   flush what is on screen at once, and a flush only ever writes, never
 *   removes: under StrictMode it runs before the page's restore has landed.
 * - **This tab's own record comes back silently** (a reload, a Back, a return
 *   from another tool): the page calls `hydrate(workspace)` before any write
 *   for that workspace can happen, and applies what it returns.
 * - **Another tab's record is only ever offered** (`useDraftOffer`), and only
 *   once that tab is known closed.
 *
 * Nothing is read or written until the tab's identity is settled
 * (`useDraftsReady`): a duplicated tab starts with a copy of its original's.
 */

/** True once this tab's draft identity is settled and drafts can be read. */
export function useDraftsReady(): boolean {
  const session = draftSession();
  return useSyncExternalStore(
    session.subscribe,
    () => session.ready,
    () => false,
  );
}

/**
 * This tab's own record for a workspace, for a page that builds its initial
 * state from it (Variant, rendered only once drafts are ready). The page
 * still calls `hydrate` in an effect to arm the mirror.
 */
export function readOwnDraft<P>(
  feature: DraftFeature,
  workspace: string,
  codec: DraftCodec<P>,
): DraftEnvelope<P> | null {
  const session = draftSession();
  const me = session.me();
  if (!me) return null;
  try {
    return parseEnvelope(session.local.get(recordKey(feature, me.tab, workspace)), codec, {
      feature,
      tab: me.tab,
      workspace,
    });
  } catch {
    // Deliberately silent: the same storage failure is reported by the hook's
    // `hydrate` and by every write it then attempts.
    return null;
  }
}

interface Options<P> {
  feature: DraftFeature;
  /** The workspace on screen, or null while there is none (a document still loading). */
  workspace: string | null;
  /** What to keep: memoize it, so the debounce restarts only when it changes. */
  payload: P;
  /** The buffer holds something worth keeping (scratch: not blank; saved document: changed). */
  keep: boolean;
  codec: DraftCodec<P>;
}

export interface Hydration<P> {
  own: DraftEnvelope<P> | null;
  /** False when this activation was already hydrated (StrictMode's second effect): apply nothing. */
  first: boolean;
}

export interface WorkspaceDraft<P> {
  ready: boolean;
  /**
   * Read this tab's own record for `workspace` and arm the mirror for it.
   * Call it before the first render that shows the workspace (or in the effect
   * of that render), then apply `own` if `first`.
   */
  hydrate: (workspace: string) => Hydration<P>;
  /** Remove this tab's record for a workspace (default: the one on screen), after a save, New, Clear or discard. */
  clear: (workspace?: string) => void;
  /** Why the last write failed, until one succeeds. */
  writeError: string | null;
}

interface Rendered<P> {
  workspace: string | null;
  payload: P;
  keep: boolean;
  hydrated: boolean;
}

const MIRROR_DEBOUNCE_MS = 500;

export function useWorkspaceDraft<P>({
  feature,
  workspace,
  payload,
  keep,
  codec,
}: Options<P>): WorkspaceDraft<P> {
  const session = draftSession();
  const ready = useDraftsReady();
  const [writeError, setWriteError] = useState<string | null>(null);
  const writeErrorRef = useRef<string | null>(null);
  const codecRef = useRef(codec);
  codecRef.current = codec;
  const hydration = useRef<{ workspace: string; own: DraftEnvelope<P> | null } | null>(null);
  const last = useRef<Rendered<P> | null>(null);
  const cleared = useRef<{ workspace: string; json: string } | null>(null);
  const wrote = useRef(false);

  const reportError = useCallback(
    (action: string, error: unknown) => {
      const reason = storageErrorReason(error);
      if (writeErrorRef.current !== reason) {
        log.warn(`drafts: ${feature} could not ${action} a draft (${reason})`, { module: 'drafts' });
      }
      writeErrorRef.current = reason;
      // `hydrate` can run during a render (Variant reads its draft in a state
      // initializer), where a state update is not allowed.
      queueMicrotask(() => setWriteError(reason));
    },
    [feature],
  );

  const persist = useRef<(workspace: string, payload: P, keep: boolean, mayRemove: boolean) => void>(
    () => undefined,
  );
  persist.current = (target, value, worthKeeping, mayRemove) => {
    const me = session.me();
    if (!me) return;
    const done = cleared.current;
    if (done && done.workspace === target && done.json === JSON.stringify(value)) return;
    const key = recordKey(feature, me.tab, target);
    try {
      if (worthKeeping) {
        const parts = { feature, tab: me.tab, workspace: target };
        session.local.set(key, JSON.stringify(makeEnvelope(parts, value, session.now())));
        if (done?.workspace === target) cleared.current = null;
        if (writeErrorRef.current !== null) {
          writeErrorRef.current = null;
          setWriteError(null);
        }
        if (!wrote.current) {
          wrote.current = true;
          // A draft of our own: older closed tabs' drafts of this editor can go.
          session.requestSweep();
        }
      } else if (mayRemove) {
        session.local.remove(key);
      }
    } catch (error) {
      reportError(worthKeeping ? 'save' : 'remove', error);
    }
  };

  // What was last on screen, written at once: on leaving, hiding, unmounting
  // or switching workspace. Only ever writes. A workspace counts as hydrated
  // if it was when shown, or is now (hydrated after its last render, with
  // nothing re-rendered since).
  const flushLast = useRef(() => undefined as void);
  flushLast.current = () => {
    const left = last.current;
    if (!left?.workspace || !left.keep) return;
    if (left.hydrated || hydration.current?.workspace === left.workspace)
      persist.current(left.workspace, left.payload, true, false);
  };

  useEffect(() => {
    session.registerFeature(feature, { codec: (raw) => codecRef.current(raw) });
  }, [session, feature]);

  // A workspace left behind: flush its last buffer under its own key, and make
  // the next one hydrate afresh. The cleanup runs before this commit's other
  // effects, so `last` still holds what the left workspace showed.
  useEffect(() => {
    if (hydration.current && hydration.current.workspace !== workspace) hydration.current = null;
    return () => flushLast.current();
  }, [workspace]);

  useEffect(() => {
    last.current = {
      workspace,
      payload,
      keep,
      hydrated: workspace !== null && hydration.current?.workspace === workspace,
    };
  });

  useEffect(() => {
    if (!ready || workspace === null) return;
    const id = window.setTimeout(() => {
      if (hydration.current?.workspace !== workspace) return;
      persist.current(workspace, payload, keep, true);
    }, MIRROR_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [ready, workspace, payload, keep]);

  useEffect(() => {
    const flush = () => flushLast.current();
    const unregister = session.registerFlusher(flush);
    return () => {
      unregister();
      flush();
    };
  }, [session]);

  const hydrate = useCallback(
    (target: string): Hydration<P> => {
      const current = hydration.current;
      if (current?.workspace === target) return { own: current.own, first: false };
      const me = session.me();
      if (!me) return { own: null, first: false };
      let own: DraftEnvelope<P> | null = null;
      try {
        own = parseEnvelope(
          session.local.get(recordKey(feature, me.tab, target)),
          codecRef.current,
          { feature, tab: me.tab, workspace: target },
        );
      } catch (error) {
        reportError('read', error);
      }
      hydration.current = { workspace: target, own };
      cleared.current = null;
      return { own, first: true };
    },
    [session, feature, reportError],
  );

  const clear = useCallback(
    (target?: string) => {
      const me = session.me();
      const which = target ?? hydration.current?.workspace ?? last.current?.workspace ?? null;
      if (!me || !which) return;
      try {
        session.local.remove(recordKey(feature, me.tab, which));
      } catch (error) {
        reportError('remove', error);
      }
      const shown = last.current;
      // Until the buffer changes, nothing writes this workspace back: a save
      // that flips to the saved document must not resurrect the scratch draft.
      cleared.current = {
        workspace: which,
        json: shown?.workspace === which ? JSON.stringify(shown.payload) : '',
      };
    },
    [session, feature, reportError],
  );

  return { ready, hydrate, clear, writeError };
}

// ── offers: another tab's draft, or the one saved before this update ─────────

export interface DraftOffer<P> {
  kind: 'tab' | 'legacy';
  payload: P;
  savedAt: number;
}

interface OfferOptions<P> {
  feature: DraftFeature;
  workspace: string | null;
  /** This activation found no draft of its own and no hand-off: an offer may be shown. */
  eligible: boolean;
  codec: DraftCodec<P>;
  /** Whether a payload is worth offering (not blank, not the editor's skeleton). */
  worth: (payload: P) => boolean;
  /** The pre-PLAN-43 single-slot draft, scratch only. */
  legacy?: LegacyParse<P>;
}

export interface OfferState<P> {
  offer: DraftOffer<P> | null;
  busy: boolean;
  error: string | null;
  /** Transfer the offered draft into this tab; resolves to it, or null when it could not be taken. */
  accept: () => Promise<P | null>;
  /** Hide it for this visit; the draft itself stays where it is. */
  dismiss: () => void;
}

interface HeldOffer<P> extends DraftOffer<P> {
  key: string | null;
  workspace: string;
}

/**
 * At most one offer at a time, in the plan's order: a closed tab's draft for
 * this workspace, else (scratch only) the draft saved before this update. The
 * page decides eligibility: its own draft and a hand-off come first.
 */
export function useDraftOffer<P>({
  feature,
  workspace,
  eligible,
  codec,
  worth,
  legacy,
}: OfferOptions<P>): OfferState<P> {
  const session = draftSession();
  const ready = useDraftsReady();
  const [held, setHeld] = useState<HeldOffer<P> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = useRef({ codec, worth, legacy });
  spec.current = { codec, worth, legacy };
  const dismissedFor = useRef<string | null>(null);

  useEffect(() => {
    setHeld(null);
    setError(null);
    if (!ready || workspace === null || !eligible || dismissedFor.current === workspace) return;
    let cancelled = false;
    let timer: number | null = null;
    let release: (() => void) | null = null;

    const search = async () => {
      const ctx = await session.coordinated();
      const me = session.me();
      if (!ctx || !me || cancelled) return;
      const { codec: decode, worth: worthOffering, legacy: legacyParse } = spec.current;
      try {
        const found = await findOffer(ctx, me, feature, workspace, decode, worthOffering);
        if (cancelled) return;
        if (found.offer) {
          release = session.protect(found.offer.key);
          setHeld({
            kind: 'tab',
            key: found.offer.key,
            workspace,
            payload: found.offer.envelope.payload,
            savedAt: found.offer.envelope.savedAt,
          });
          return;
        }
        if (found.recheckAt !== null) {
          // A tab left moments ago: offer its draft once it has been gone long
          // enough not to be a reload, and offer nothing older meanwhile.
          timer = window.setTimeout(() => void search(), Math.max(50, found.recheckAt - ctx.now() + 50));
          return;
        }
        if (legacyParse && workspace === SCRATCH) {
          const old = await findLegacy(ctx, feature, legacyParse);
          if (old && !cancelled && worthOffering(old.payload)) {
            setHeld({ kind: 'legacy', key: null, workspace, payload: old.payload, savedAt: old.savedAt });
          }
        }
      } catch (failure) {
        session.warnOnce(
          `offer:${feature}`,
          `drafts: ${feature} could not look for another tab's draft (${storageErrorReason(failure)})`,
        );
      }
    };
    void search();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      release?.();
    };
  }, [session, feature, ready, workspace, eligible]);

  const accept = useCallback(async (): Promise<P | null> => {
    const offer = held;
    if (!offer || busy) return null;
    const ctx = await session.coordinated();
    const me = session.me();
    if (!ctx || !me) {
      setError('This browser cannot hand drafts between tabs right now.');
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const result =
        offer.kind === 'tab' && offer.key
          ? await acceptOffer(ctx, me, offer.key, spec.current.codec)
          : spec.current.legacy
            ? await acceptLegacy(ctx, me, feature, offer.workspace, spec.current.legacy)
            : ({ status: 'gone' } as const);
      if (result.status === 'ok') {
        if (result.warning) log.warn(`drafts: ${feature} restore: ${result.warning}`, { module: 'drafts' });
        setHeld(null);
        dismissedFor.current = offer.workspace;
        return result.payload;
      }
      if (result.status === 'gone') {
        setHeld(null);
        setError('That draft is no longer available — another tab may have restored it.');
        return null;
      }
      log.warn(`drafts: ${feature} could not restore a draft (${result.reason})`, { module: 'drafts' });
      setError(`The draft could not be restored: ${result.reason}. It is still kept.`);
      return null;
    } finally {
      setBusy(false);
    }
  }, [session, feature, held, busy]);

  const dismiss = useCallback(() => {
    if (held) dismissedFor.current = held.workspace;
    setHeld(null);
    setError(null);
  }, [held]);

  const offer =
    held && held.workspace === workspace
      ? { kind: held.kind, payload: held.payload, savedAt: held.savedAt }
      : null;
  return { offer, busy, error, accept, dismiss };
}
