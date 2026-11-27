import { useMemo, useState } from 'react';
import { useDraftOffer, useWorkspaceDraft, type DraftOffer } from './draftCache';
import {
  baselineOf,
  sameBaseline,
  textDraftCodec,
  type DocBaseline,
  type ServerDoc,
  type TextDraft,
} from './drafts/documents';
import type { LegacyParse } from './drafts/protocol';
import { SCRATCH, docWorkspace, type DraftFeature } from './drafts/records';

/**
 * The draft flow Runestone, Edda, Groot and Atlas share (PLAN-43): a scratch
 * workspace and one per saved document, each mirrored per tab; this tab's own
 * draft restored silently, another tab's offered; a saved document's working
 * copy checked against the server copy it was edited from.
 *
 * The page keeps its buffer (title, text, format) and applies what this hands
 * back: `loaded` and `enterScratch` on arrival, `restore` and `takeServer` on
 * the person's choice.
 */

/** A draft whose baseline is unknown conflicts with any server copy. */
const UNKNOWN_BASELINE: DocBaseline = { hash: '', modifiedAt: 0 };

export interface LoadedDoc extends ServerDoc {
  id: string;
}

interface Options {
  feature: Exclude<DraftFeature, 'variant'>;
  isScratch: boolean;
  phase: 'new' | 'loading' | 'saved' | 'notfound';
  docId: string | null;
  title: string;
  text: string;
  /** Runestone's JSON/JSONC; omitted by the others. */
  format?: string;
  /** The scratch buffer holds nothing worth keeping. */
  blank: boolean;
  /** A saved document's buffer differs from its saved copy. */
  dirty: boolean;
  /** Whether a draft is worth offering (Atlas: not its skeleton). */
  worth: (draft: TextDraft) => boolean;
  legacy: LegacyParse<TextDraft>;
}

export interface DocumentDrafts {
  ready: boolean;
  workspace: string | null;
  /** A saved document arrived: returns this tab's working copy of it to show, or null for the server copy. */
  loaded: (doc: LoadedDoc) => TextDraft | null;
  /** The scratch editor arrived: `first` false means already handled (StrictMode). */
  enterScratch: () => { first: boolean; own: TextDraft | null };
  /** Whether the scratch editor may offer another tab's or the pre-update draft. */
  offerScratch: (eligible: boolean) => void;
  /** The server accepted a save: drop the draft of the workspace that was saved. */
  saved: (doc: LoadedDoc, from: 'scratch' | 'doc') => void;
  /** Take the offered draft into this tab. */
  restore: () => Promise<TextDraft | null>;
  /** Discard this workspace's draft (New, Clear). */
  clear: () => void;
  /** Leaving the saved document for scratch, or carving from a 404. */
  reset: () => void;
  conflict: boolean;
  keepLocal: () => void;
  /** Take the server copy instead of the local edits: returns it to show. */
  takeServer: () => ServerDoc | null;
  offer: DraftOffer<TextDraft> | null;
  offerBusy: boolean;
  offerError: string | null;
  dismissOffer: () => void;
  writeError: string | null;
  /** Offers show only while there is nothing to lose by taking one. */
  showOffer: boolean;
}

export function useDocumentDrafts({
  feature,
  isScratch,
  phase,
  docId,
  title,
  text,
  format,
  blank,
  dirty,
  worth,
  legacy,
}: Options): DocumentDrafts {
  // The server copy a saved document was loaded or last saved as.
  const [server, setServer] = useState<ServerDoc | null>(null);
  // Set while a restored draft's baseline no longer matches the server copy:
  // the draft keeps that baseline until the person picks a version.
  const [conflict, setConflict] = useState<DocBaseline | null>(null);
  // The workspace whose activation found no draft of its own and no hand-off.
  const [offerFor, setOfferFor] = useState<string | null>(null);

  const workspace = isScratch ? SCRATCH : phase === 'saved' && docId ? docWorkspace(docId) : null;
  const serverBaseline = useMemo(() => (server ? baselineOf(server) : null), [server]);
  const payload = useMemo<TextDraft>(
    () => ({
      title,
      text,
      ...(format !== undefined ? { format } : {}),
      baseline: workspace === SCRATCH ? null : (conflict ?? serverBaseline),
    }),
    [title, text, format, workspace, conflict, serverBaseline],
  );
  const draft = useWorkspaceDraft<TextDraft>({
    feature,
    workspace,
    payload,
    keep: workspace === SCRATCH ? !blank : dirty,
    codec: textDraftCodec,
  });
  const offers = useDraftOffer<TextDraft>({
    feature,
    workspace,
    eligible: offerFor !== null && offerFor === workspace,
    codec: textDraftCodec,
    worth,
    legacy,
  });

  const conflictFor = (restored: TextDraft, doc: ServerDoc): DocBaseline | null =>
    sameBaseline(restored.baseline, doc) ? null : (restored.baseline ?? UNKNOWN_BASELINE);

  const asServer = (doc: LoadedDoc): ServerDoc => ({
    name: doc.name,
    content: doc.content,
    ...(doc.format !== undefined ? { format: doc.format } : {}),
    modifiedAt: doc.modifiedAt,
  });

  return {
    ready: draft.ready,
    workspace,
    loaded: (doc) => {
      const hydration = draft.hydrate(docWorkspace(doc.id));
      const copy = asServer(doc);
      setServer(copy);
      const own = hydration.first ? (hydration.own?.payload ?? null) : null;
      if (own) {
        setConflict(conflictFor(own, copy));
        setOfferFor(null);
        return own;
      }
      setConflict(null);
      setOfferFor(hydration.first ? docWorkspace(doc.id) : null);
      return null;
    },
    enterScratch: () => {
      const hydration = draft.hydrate(SCRATCH);
      return { first: hydration.first, own: hydration.own?.payload ?? null };
    },
    offerScratch: (eligible) => setOfferFor(eligible ? SCRATCH : null),
    saved: (doc, from) => {
      // Only after the server said yes: a failed save keeps the draft.
      draft.clear(from === 'scratch' ? SCRATCH : docWorkspace(doc.id));
      setServer(asServer(doc));
      setConflict(null);
    },
    restore: async () => {
      const restored = await offers.accept();
      if (restored && workspace !== SCRATCH && server) setConflict(conflictFor(restored, server));
      return restored;
    },
    clear: () => draft.clear(),
    reset: () => {
      setServer(null);
      setConflict(null);
    },
    conflict: conflict !== null,
    keepLocal: () => setConflict(null),
    takeServer: () => {
      setConflict(null);
      draft.clear();
      return server;
    },
    offer: offers.offer,
    offerBusy: offers.busy,
    offerError: offers.error,
    dismissOffer: offers.dismiss,
    writeError: draft.writeError,
    showOffer: workspace === SCRATCH ? blank : !dirty,
  };
}
