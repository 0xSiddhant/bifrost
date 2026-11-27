import type { CoordBackend, CoordTx } from './coordinator';
import {
  LEFT_PREFIX,
  OFFER_GRACE_MS,
  PRUNE_GRACE_MS,
  RECORD_PREFIX,
  departureValue,
  hashText,
  leftKey,
  makeEnvelope,
  parseDeparture,
  parseEnvelope,
  parseRecordKey,
  recordKey,
  type Departure,
  type DraftCodec,
  type DraftEnvelope,
  type DraftFeature,
  type RecordKeyParts,
} from './records';
import { storageErrorReason, type DraftStorage } from './storage';

/**
 * The cross-tab half of PLAN-43: which tab is known to have closed, offering
 * and transferring its draft exactly once, pruning closed tabs' drafts, and
 * recovering the four pre-PLAN-43 single-slot drafts.
 *
 * **Known closed.** No browser event tells a closing tab from one that is
 * reloading or navigating to another site: the spike saw the same
 * `pagehide(persisted=false)` for all three. So a tab is known closed only when
 * (1) it left a departure marker naming its page lifetime (written last, at
 * `pagehide` with `persisted === false`, after its drafts were flushed), (2)
 * the IndexedDB registry still names that same lifetime — a reload, a Back
 * navigation or a reopened tab registers a new one the moment it starts — and
 * (3) the marker is older than a grace period. A frozen, discarded or killed
 * tab, or one in the back/forward cache, writes no marker and is never
 * treated as closed. The owner accepted the one residual risk (2026-11-26): a
 * tab that leaves the app and comes back later than the grace may find its
 * draft moved to another tab (after 10 s) or pruned (after 10 minutes).
 */

export { OFFER_GRACE_MS, PRUNE_GRACE_MS } from './records';
/**
 * A claim older than this is assumed abandoned (its tab died mid-transfer) and
 * is reconciled: completed if its destination verifies, released if not. A
 * transfer takes milliseconds; neither outcome deletes the only copy.
 */
export const CLAIM_LEASE_MS = 30_000;

export interface ProtocolContext {
  local: DraftStorage;
  backend: CoordBackend;
  now: () => number;
}

export interface Me {
  tab: string;
  instance: string;
}

interface TabEntry {
  instance: string;
  at: number;
}

interface GoneEntry {
  phase: 'claimed' | 'done';
  reason: 'transferred' | 'pruned';
  /** The source tab's page lifetime this decision was made about. */
  srcInstance: string;
  at: number;
  by?: string;
  instance?: string;
  dest?: string;
  hash?: string;
}

interface LegacyJournal {
  phase: 'claimed' | 'consumed';
  by: string;
  instance: string;
  dest: string;
  /** Hash of the legacy key's raw value this journal is about. */
  hash: string;
  /** Hash of the payload written to `dest`, to verify it later. */
  payloadHash: string;
  at: number;
}

const tabEntryKey = (tab: string) => `tab:${tab}`;
const goneKey = (key: string) => `gone:${key}`;
const legacyJournalKey = (feature: DraftFeature) => `legacy:${feature}`;
/** A closed tab's draft someone dismissed: not offered again, in any tab. */
const dismissedKey = (key: string) => `dismissed:${key}`;
/** The pre-update draft someone dismissed, by the hash of its raw value. */
const legacyDismissedKey = (feature: DraftFeature) => `dismissed-legacy:${feature}`;

interface Dismissal {
  /** The source tab's page lifetime (a tab draft), or the raw value's hash (legacy). */
  about: string;
  at: number;
}

function asDismissal(value: unknown): Dismissal | null {
  const entry = value as Partial<Dismissal> | undefined;
  return entry && typeof entry.about === 'string' ? (entry as Dismissal) : null;
}

interface Candidate {
  record: StoredRecord;
  departure: Departure;
  savedAt: number;
}

/** Newest first: the latest departure, then the latest save, then key order. */
const newestFirst = (a: Candidate, b: Candidate): number =>
  b.departure.at - a.departure.at ||
  b.savedAt - a.savedAt ||
  (a.record.key < b.record.key ? -1 : a.record.key > b.record.key ? 1 : 0);

/** Any stored payload, for verifying a destination by hash. */
const anyPayload: DraftCodec<unknown> = (raw) => (raw === undefined ? null : raw);
const payloadHash = (payload: unknown): string => hashText(JSON.stringify(payload));

function asTabEntry(value: unknown): TabEntry | null {
  const entry = value as Partial<TabEntry> | undefined;
  return entry && typeof entry.instance === 'string' ? (entry as TabEntry) : null;
}
function asGone(value: unknown): GoneEntry | null {
  const entry = value as Partial<GoneEntry> | undefined;
  return entry && (entry.phase === 'claimed' || entry.phase === 'done')
    ? (entry as GoneEntry)
    : null;
}
function asJournal(value: unknown): LegacyJournal | null {
  const entry = value as Partial<LegacyJournal> | undefined;
  return entry && (entry.phase === 'claimed' || entry.phase === 'consumed')
    ? (entry as LegacyJournal)
    : null;
}

interface StoredRecord {
  key: string;
  parts: RecordKeyParts;
}

function listRecords(local: DraftStorage): StoredRecord[] {
  const found: StoredRecord[] = [];
  for (const key of local.keys()) {
    if (!key.startsWith(RECORD_PREFIX)) continue;
    const parts = parseRecordKey(key);
    if (parts) found.push({ key, parts });
  }
  return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function tabFromLeftKey(key: string): string | null {
  try {
    return decodeURIComponent(key.slice(LEFT_PREFIX.length));
  } catch {
    return null;
  }
}

/** Every departed tab whose departure the registry confirms (no newer lifetime since). */
function confirmedDepartures(tx: CoordTx, local: DraftStorage): Map<string, Departure> {
  const departed = new Map<string, Departure>();
  for (const key of local.keys()) {
    if (!key.startsWith(LEFT_PREFIX)) continue;
    const tab = tabFromLeftKey(key);
    const departure = parseDeparture(local.get(key));
    if (!tab || !departure) continue;
    const entry = asTabEntry(tx.get(tabEntryKey(tab)));
    // No registry entry: the tab never registered (no IndexedDB there), so its
    // departure cannot be confirmed. Fail closed.
    if (entry && entry.instance === departure.instance) departed.set(tab, departure);
  }
  return departed;
}

/** True when the source tab has not started a new page lifetime since `srcInstance`. */
function notReclaimed(tx: CoordTx, tab: string, srcInstance: string): boolean {
  return asTabEntry(tx.get(tabEntryKey(tab)))?.instance === srcInstance;
}

function tryRemove(local: DraftStorage, key: string): boolean {
  try {
    local.remove(key);
    return true;
  } catch {
    // The caller keeps the tombstone or journal that hides the value instead.
    return false;
  }
}

/** Claims whose tab died mid-transfer: complete them if the copy landed, release them if not. */
function reconcileClaims(tx: CoordTx, local: DraftStorage, now: number): void {
  for (const key of tx.keys()) {
    if (!key.startsWith('gone:')) continue;
    const gone = asGone(tx.get(key));
    if (!gone || gone.phase !== 'claimed' || now - gone.at <= CLAIM_LEASE_MS) continue;
    const source = key.slice('gone:'.length);
    const destParts = gone.dest ? parseRecordKey(gone.dest) : null;
    const dest =
      destParts && gone.dest ? parseEnvelope(local.get(gone.dest), anyPayload, destParts) : null;
    if (dest && payloadHash(dest.payload) === gone.hash) {
      tx.put(key, { ...gone, phase: 'done', at: now } satisfies GoneEntry);
      const parts = parseRecordKey(source);
      if (parts && notReclaimed(tx, parts.tab, gone.srcInstance)) tryRemove(local, source);
    } else {
      tx.del(key);
    }
  }
}

/**
 * Start of a page lifetime: from now on this tab's earlier departure means
 * nothing. `stillCurrent` is asked inside the transaction: a tab that gave its
 * id up to a live twin while this waited must not write the twin's entry.
 */
export async function registerLifetime(
  ctx: ProtocolContext,
  me: Me,
  stillCurrent: () => boolean = () => true,
): Promise<boolean> {
  return ctx.backend.run((tx) => {
    if (!stillCurrent()) return false;
    tx.put(tabEntryKey(me.tab), { instance: me.instance, at: ctx.now() } satisfies TabEntry);
    // Decisions about this tab's records were about an earlier lifetime.
    for (const key of tx.keys()) {
      if (!key.startsWith('gone:')) continue;
      const parts = parseRecordKey(key.slice('gone:'.length));
      if (parts?.tab === me.tab) tx.del(key);
    }
    tryRemove(ctx.local, leftKey(me.tab));
    return true;
  });
}

/**
 * This page gave up a tab id it had registered (a live twin kept it): remove
 * the entry if it still names this page, so the twin's lifetime is the one on
 * record. The twin re-registers itself as well; whichever lands last is right.
 */
export async function releaseLifetime(ctx: ProtocolContext, former: Me): Promise<void> {
  await ctx.backend.run((tx) => {
    if (asTabEntry(tx.get(tabEntryKey(former.tab)))?.instance === former.instance)
      tx.del(tabEntryKey(former.tab));
  });
}

/** Written last at `pagehide` (not persisted): synchronous, after every flush. */
export function writeDeparture(local: DraftStorage, me: Me, at: number): void {
  local.set(leftKey(me.tab), departureValue(me.instance, at));
}

export interface FoundOffer<P> {
  key: string;
  envelope: DraftEnvelope<P>;
  /** The closed tab's page lifetime, for `dismissOffer`. */
  srcInstance: string;
}

export interface OfferSearch<P> {
  offer: FoundOffer<P> | null;
  /** When a departure too recent to offer yet will be old enough. */
  recheckAt: number | null;
}

/**
 * The one draft a blank tab may be offered for this editor and workspace: the
 * newest (latest departure, then latest save) whose tab is known closed, which
 * nobody has claimed and nobody has dismissed. While the newest is still inside
 * the grace (its tab may be reloading), nothing older is offered meanwhile:
 * `recheckAt` says when to look again.
 */
export async function findOffer<P>(
  ctx: ProtocolContext,
  me: Me,
  feature: DraftFeature,
  workspace: string,
  codec: DraftCodec<P>,
  worth: (payload: P) => boolean,
): Promise<OfferSearch<P>> {
  return ctx.backend.run((tx) => {
    const now = ctx.now();
    reconcileClaims(tx, ctx.local, now);
    const departed = confirmedDepartures(tx, ctx.local);
    const candidates: (Candidate & { envelope: DraftEnvelope<P> })[] = [];
    for (const record of listRecords(ctx.local)) {
      const { parts } = record;
      if (parts.feature !== feature || parts.workspace !== workspace || parts.tab === me.tab)
        continue;
      const departure = departed.get(parts.tab);
      if (!departure || tx.get(goneKey(record.key)) !== undefined) continue;
      if (asDismissal(tx.get(dismissedKey(record.key)))?.about === departure.instance) continue;
      const envelope = parseEnvelope(ctx.local.get(record.key), codec, parts);
      if (!envelope || !worth(envelope.payload)) continue;
      candidates.push({ record, departure, savedAt: envelope.savedAt, envelope });
    }
    const newest = candidates.sort(newestFirst)[0];
    if (!newest) return { offer: null, recheckAt: null };
    if (now - newest.departure.at < OFFER_GRACE_MS) {
      return { offer: null, recheckAt: newest.departure.at + OFFER_GRACE_MS };
    }
    return {
      offer: {
        key: newest.record.key,
        envelope: newest.envelope,
        srcInstance: newest.departure.instance,
      },
      recheckAt: null,
    };
  });
}

/**
 * Not this one: a closed tab's draft the person dismissed is not offered
 * again, in this tab or any other, while that tab stays closed. The draft
 * itself stays where it is (pruned by the usual rules); a tab that comes back
 * starts a new lifetime, and its drafts count afresh.
 */
export async function dismissOffer(
  ctx: ProtocolContext,
  sourceKey: string,
  srcInstance: string,
): Promise<void> {
  await ctx.backend.run((tx) => {
    tx.put(dismissedKey(sourceKey), { about: srcInstance, at: ctx.now() } satisfies Dismissal);
  });
}

export type AcceptResult<P> =
  | { status: 'ok'; payload: P; savedAt: number; warning?: string }
  | { status: 'gone' }
  /** This tab already holds a draft for the workspace: never overwritten, the offer stays put. */
  | { status: 'own' }
  | { status: 'failed'; reason: string };

/** True when this tab already holds a readable record at `dest`. */
function holdsOwn(local: DraftStorage, dest: string, parts: RecordKeyParts): boolean {
  return parseEnvelope(local.get(dest), anyPayload, parts) !== null;
}

/** Write `payload` as this tab's record and read it back; null on success, else why not. */
function writeVerified(local: DraftStorage, key: string, raw: string): string | null {
  try {
    local.set(key, raw);
    if (local.get(key) === raw) return null;
    tryRemove(local, key);
    return 'the copy did not read back';
  } catch (error) {
    return storageErrorReason(error);
  }
}

/**
 * What a restore holds once it has claimed a draft: where the copy goes, and
 * how to read, release and complete the claim (a closed tab's `gone:` entry,
 * or the pre-update draft's journal).
 */
interface Transfer<P, E> {
  dest: string;
  destParts: RecordKeyParts;
  claimed: { payload: P; savedAt: number };
  /** 'done' when another tab's reconciliation completed it for this one; 'lost' when the claim is no longer this one's. */
  claim: (tx: CoordTx) => 'done' | 'lost' | { held: E };
  /** Drop this lifetime's claim, if it still holds it. */
  release: (tx: CoordTx) => void;
  /** Mark the claim done and remove the source: 'kept-source' when it could not be removed. */
  complete: (tx: CoordTx, held: E) => 'ok' | 'kept-source';
  keptSourceWarning: string;
}

/**
 * Write this tab's copy of a claimed draft, verify it, and complete the
 * claim. This tab's own newer work always wins over the restore, up to the
 * moment the transfer completes: a record of its own at the destination (the
 * mirror can write while a claim is awaited), or a buffer that changed on
 * screen since the restore began (`unchanged` false; the mirror is debounced
 * and may not have written yet). Then the restore stands down: the claim is
 * released, the source stays where it was, and only the copy this restore
 * wrote is ever removed. A change that lands after the transfer completed
 * gives way to the draft the person asked for.
 */
async function finishTransfer<P, E>(
  ctx: ProtocolContext,
  t: Transfer<P, E>,
  unchanged: () => boolean,
): Promise<AcceptResult<P>> {
  const own = () => holdsOwn(ctx.local, t.dest, t.destParts);
  const release = () =>
    ctx.backend.run(t.release).catch(() => {
      // The lease runs out and reconciliation releases it: this tab's copy of
      // the claimed draft is not there, so the source stays.
    });

  // Asked again with nothing awaited between this and the write: the claim's
  // transaction gave the mirror, and the person, time to act.
  if (!unchanged() || own()) {
    await release();
    return { status: 'own' };
  }
  const raw = JSON.stringify(makeEnvelope(t.destParts, t.claimed.payload, t.claimed.savedAt));
  const writeFailure = writeVerified(ctx.local, t.dest, raw);
  if (writeFailure) {
    await release();
    return { status: 'failed', reason: writeFailure };
  }
  const ours = () => ctx.local.get(t.dest) === raw;
  const dropCopy = () => {
    if (ours()) tryRemove(ctx.local, t.dest);
  };

  let outcome: 'ok' | 'kept-source' | 'lost' | 'own' | { failed: string };
  try {
    outcome = await ctx.backend.run((tx) => {
      const claim = t.claim(tx);
      // Stalled past the lease, another tab's reconciliation found this tab's
      // copy verified and completed the transfer for it: that is success.
      if (claim === 'done') return 'ok';
      if (claim === 'lost') return 'lost';
      if (!unchanged() || (!ours() && own())) {
        dropCopy();
        t.release(tx);
        return 'own';
      }
      // Removed meanwhile (a mirror tick armed before the restore, with
      // nothing worth keeping on screen): put it back before completing.
      if (!ours()) {
        const failure = writeVerified(ctx.local, t.dest, raw);
        if (failure) {
          t.release(tx);
          return { failed: failure };
        }
      }
      return t.complete(tx, claim.held);
    });
  } catch (error) {
    // The transfer could not be marked complete, and the claim still names
    // this tab: reconciliation completes it while the copy is there, or
    // releases it once it is not.
    if (!unchanged()) {
      dropCopy();
      return { status: 'own' };
    }
    if (!ours()) writeVerified(ctx.local, t.dest, raw);
    return {
      status: 'ok',
      payload: t.claimed.payload,
      savedAt: t.claimed.savedAt,
      warning: `the transfer could not be marked complete (${storageErrorReason(error)})`,
    };
  }
  if (outcome === 'lost') {
    // Another tab completed or released the claim meanwhile.
    dropCopy();
    return own() ? { status: 'own' } : { status: 'gone' };
  }
  if (outcome === 'own') return { status: 'own' };
  if (typeof outcome === 'object') return { status: 'failed', reason: outcome.failed };
  return {
    status: 'ok',
    payload: t.claimed.payload,
    savedAt: t.claimed.savedAt,
    ...(outcome === 'kept-source' ? { warning: t.keptSourceWarning } : {}),
  };
}

/**
 * Take a closed tab's draft into this tab, once: claim it, write and verify
 * this tab's copy, then mark the claim done and remove the source. A failed
 * write releases the claim and keeps the source; a lost claim removes the
 * copy, so two tabs never both restore it. `unchanged` says whether the
 * buffer on screen is still what it was when the person chose to restore:
 * see `finishTransfer`.
 */
export async function acceptOffer<P>(
  ctx: ProtocolContext,
  me: Me,
  sourceKey: string,
  codec: DraftCodec<P>,
  unchanged: () => boolean = () => true,
): Promise<AcceptResult<P>> {
  const source = parseRecordKey(sourceKey);
  if (!source) return { status: 'gone' };
  const destParts: RecordKeyParts = { ...source, tab: me.tab };
  const dest = recordKey(source.feature, me.tab, source.workspace);
  const tombstone = goneKey(sourceKey);

  let claimed: DraftEnvelope<P> | 'own' | null;
  try {
    claimed = await ctx.backend.run((tx) => {
      const now = ctx.now();
      reconcileClaims(tx, ctx.local, now);
      // This tab's own draft for the workspace is never overwritten: it was
      // typed after the offer appeared, and is newer work than the offer.
      if (!unchanged() || holdsOwn(ctx.local, dest, destParts)) return 'own' as const;
      const departure = confirmedDepartures(tx, ctx.local).get(source.tab);
      if (!departure || now - departure.at < OFFER_GRACE_MS) return null;
      if (tx.get(tombstone) !== undefined) return null;
      const envelope = parseEnvelope(ctx.local.get(sourceKey), codec, source);
      if (!envelope) return null;
      tx.put(tombstone, {
        phase: 'claimed',
        reason: 'transferred',
        srcInstance: departure.instance,
        at: now,
        by: me.tab,
        instance: me.instance,
        dest,
        hash: payloadHash(envelope.payload),
      } satisfies GoneEntry);
      return envelope;
    });
  } catch (error) {
    return { status: 'failed', reason: `draft coordination failed (${storageErrorReason(error)})` };
  }
  if (claimed === 'own') return { status: 'own' };
  if (!claimed) return { status: 'gone' };

  return finishTransfer(
    ctx,
    {
      dest,
      destParts,
      claimed,
      claim: (tx) => {
        const gone = asGone(tx.get(tombstone));
        if (gone?.phase === 'done' && gone.instance === me.instance && gone.dest === dest)
          return 'done';
        if (!gone || gone.phase !== 'claimed' || gone.instance !== me.instance) return 'lost';
        return { held: gone };
      },
      release: (tx) => {
        const gone = asGone(tx.get(tombstone));
        if (gone?.phase === 'claimed' && gone.instance === me.instance) tx.del(tombstone);
      },
      complete: (tx, gone) => {
        tx.put(tombstone, { ...gone, phase: 'done', at: ctx.now() } satisfies GoneEntry);
        if (!notReclaimed(tx, source.tab, gone.srcInstance)) return 'ok';
        return tryRemove(ctx.local, sourceKey) ? 'ok' : 'kept-source';
      },
      keptSourceWarning: 'the other tab’s copy could not be removed; it will not be offered again',
    },
    unchanged,
  );
}

export interface SweepFeature {
  codec: DraftCodec<unknown>;
}

/**
 * Prune closed tabs' drafts, newest first (owner, 2026-11-26). For each
 * editor and workspace (the scratch editor, each saved document, Variant's
 * workbench), since that is what an offer is made for: when this tab holds a
 * valid draft of its own there, every closed tab's draft past the prune grace
 * goes; otherwise the newest closed draft stays and the older ones go. A
 * scratch draft never costs a saved document's unsaved edits, or the reverse. Only this tab's own records count as "a newer draft
 * exists" among live tabs, because another live tab's record could be cleared
 * by its owner at any moment and this tab might read it stale. A record
 * another tab is being offered right now (`protect`) is left alone, as are
 * corrupt or unknown records, which are never deleted.
 */
export async function sweep(
  ctx: ProtocolContext,
  me: Me,
  features: Partial<Record<DraftFeature, SweepFeature>>,
  protect: ReadonlySet<string> = new Set(),
): Promise<number> {
  return ctx.backend.run((tx) => {
    const now = ctx.now();
    reconcileClaims(tx, ctx.local, now);
    const departed = confirmedDepartures(tx, ctx.local);
    const records = listRecords(ctx.local);
    let pruned = 0;

    for (const [feature, spec] of Object.entries(features) as [DraftFeature, SweepFeature][]) {
      const byWorkspace = new Map<string, StoredRecord[]>();
      for (const record of records) {
        if (record.parts.feature !== feature) continue;
        const group = byWorkspace.get(record.parts.workspace) ?? [];
        group.push(record);
        byWorkspace.set(record.parts.workspace, group);
      }
      for (const group of byWorkspace.values()) {
        const own = group.filter(
          (record) =>
            record.parts.tab === me.tab &&
            parseEnvelope(ctx.local.get(record.key), spec.codec, record.parts) !== null,
        );
        const closed = group
          .map((record): Candidate | null => {
            const departure = departed.get(record.parts.tab);
            if (!departure || now - departure.at < OFFER_GRACE_MS) return null;
            if (tx.get(goneKey(record.key)) !== undefined) return null;
            const envelope = parseEnvelope(ctx.local.get(record.key), spec.codec, record.parts);
            return envelope ? { record, departure, savedAt: envelope.savedAt } : null;
          })
          .filter((entry): entry is Candidate => entry !== null)
          .sort(newestFirst);
        const keep = own.length === 0 ? closed[0] : undefined;
        for (const entry of closed) {
          if (entry === keep || protect.has(entry.record.key)) continue;
          if (now - entry.departure.at < PRUNE_GRACE_MS) continue;
          tx.put(goneKey(entry.record.key), {
            phase: 'done',
            reason: 'pruned',
            srcInstance: entry.departure.instance,
            at: now,
          } satisfies GoneEntry);
          tryRemove(ctx.local, entry.record.key);
          pruned += 1;
        }
      }
    }

    // Housekeeping: tombstones and dismissals whose record is gone, and
    // departed tabs with nothing left to decide about.
    const present = new Set(listRecords(ctx.local).map((record) => record.key));
    for (const key of tx.keys()) {
      if (key.startsWith('dismissed:') && !present.has(key.slice('dismissed:'.length))) tx.del(key);
    }
    for (const key of tx.keys()) {
      if (!key.startsWith('gone:')) continue;
      const gone = asGone(tx.get(key));
      const source = key.slice('gone:'.length);
      if (!gone || gone.phase !== 'done') continue;
      if (present.has(source)) {
        const parts = parseRecordKey(source);
        if (parts && notReclaimed(tx, parts.tab, gone.srcInstance) && tryRemove(ctx.local, source))
          present.delete(source);
        continue;
      }
      // The record is gone. The decision is kept a while longer: a claimant
      // that stalled past its lease, whose transfer another tab completed,
      // must still find it marked done (not lost) and keep its copy.
      if (now - gone.at > PRUNE_GRACE_MS) tx.del(key);
    }
    for (const [tab, departure] of departed) {
      if (now - departure.at < OFFER_GRACE_MS) continue;
      const hasRecords = [...present].some((key) => parseRecordKey(key)?.tab === tab);
      const hasClaims = tx
        .keys()
        .some((key) => key.startsWith('gone:') && parseRecordKey(key.slice(5))?.tab === tab);
      if (hasRecords || hasClaims) continue;
      if (tryRemove(ctx.local, leftKey(tab))) tx.del(tabEntryKey(tab));
    }
    return pruned;
  });
}

// ── legacy single-slot drafts (before PLAN-43) ─────────────────────────────

export const LEGACY_KEYS: Partial<Record<DraftFeature, string>> = {
  runestone: 'bifrost.runestone.draft',
  edda: 'bifrost.edda.draft',
  groot: 'bifrost.groot.draft',
  atlas: 'bifrost.atlas.draft',
};

export interface LegacyParse<P> {
  /** The old record's raw JSON → this editor's payload, or null when invalid or blank. */
  parse: (raw: string) => { payload: P; savedAt: number } | null;
}

export interface LegacyOffer<P> {
  payload: P;
  savedAt: number;
  /** Hash of the old key's raw value, for `dismissLegacy`. */
  hash: string;
}

function reconcileLegacy(
  tx: CoordTx,
  local: DraftStorage,
  feature: DraftFeature,
  legacyKey: string,
  now: number,
): void {
  const journal = asJournal(tx.get(legacyJournalKey(feature)));
  if (!journal) return;
  const raw = local.get(legacyKey);
  if (journal.phase === 'consumed') {
    // Consumed and gone: nothing left to remember. A value an older tab wrote
    // since has another hash and is offered on its own merits.
    if (raw === null) tx.del(legacyJournalKey(feature));
    else if (hashText(raw) === journal.hash) tryRemove(local, legacyKey);
    return;
  }
  if (now - journal.at <= CLAIM_LEASE_MS) return;
  const destParts = parseRecordKey(journal.dest);
  const dest = destParts ? parseEnvelope(local.get(journal.dest), anyPayload, destParts) : null;
  if (dest && payloadHash(dest.payload) === journal.payloadHash) {
    tx.put(legacyJournalKey(feature), {
      ...journal,
      phase: 'consumed',
      at: now,
    } satisfies LegacyJournal);
    if (raw !== null && hashText(raw) === journal.hash) tryRemove(local, legacyKey);
  } else {
    tx.del(legacyJournalKey(feature));
  }
}

/** The pre-update draft this editor may offer, or null (none, blank, claimed or consumed). */
export async function findLegacy<P>(
  ctx: ProtocolContext,
  feature: DraftFeature,
  legacy: LegacyParse<P>,
): Promise<LegacyOffer<P> | null> {
  const legacyKey = LEGACY_KEYS[feature];
  if (!legacyKey) return null;
  return ctx.backend.run((tx) => {
    reconcileLegacy(tx, ctx.local, feature, legacyKey, ctx.now());
    const raw = ctx.local.get(legacyKey);
    if (raw === null) {
      tx.del(legacyDismissedKey(feature));
      return null;
    }
    const parsed = legacy.parse(raw);
    if (!parsed) return null;
    const hash = hashText(raw);
    const journal = asJournal(tx.get(legacyJournalKey(feature)));
    if (journal?.phase === 'claimed') return null;
    if (journal?.phase === 'consumed' && journal.hash === hash) return null;
    if (asDismissal(tx.get(legacyDismissedKey(feature)))?.about === hash) return null;
    return { ...parsed, hash };
  });
}

/**
 * Not this one: the pre-update draft the person dismissed is not offered
 * again, in any tab, while the old key holds the same value. The value itself
 * stays (an older build may still read it); a different value is offered on
 * its own merits.
 */
export async function dismissLegacy(
  ctx: ProtocolContext,
  feature: DraftFeature,
  hash: string,
): Promise<void> {
  await ctx.backend.run((tx) => {
    tx.put(legacyDismissedKey(feature), { about: hash, at: ctx.now() } satisfies Dismissal);
  });
}

/**
 * Take the pre-update draft into this tab's scratch workspace, once: journal
 * the claim and its destination, write and verify the copy, then mark the
 * journal consumed and remove the old key. The old value is never removed
 * before this tab's copy has read back, and never if it changed meanwhile.
 * `unchanged`: as for `acceptOffer`.
 */
export async function acceptLegacy<P>(
  ctx: ProtocolContext,
  me: Me,
  feature: DraftFeature,
  workspace: string,
  legacy: LegacyParse<P>,
  unchanged: () => boolean = () => true,
): Promise<AcceptResult<P>> {
  const legacyKey = LEGACY_KEYS[feature];
  if (!legacyKey) return { status: 'gone' };
  const destParts: RecordKeyParts = { feature, tab: me.tab, workspace };
  const dest = recordKey(feature, me.tab, workspace);
  const journalKey = legacyJournalKey(feature);

  let claimed: { payload: P; savedAt: number } | 'own' | null;
  try {
    claimed = await ctx.backend.run((tx) => {
      const now = ctx.now();
      reconcileLegacy(tx, ctx.local, feature, legacyKey, now);
      if (!unchanged() || holdsOwn(ctx.local, dest, destParts)) return 'own' as const;
      const raw = ctx.local.get(legacyKey);
      if (raw === null) return null;
      const parsed = legacy.parse(raw);
      if (!parsed) return null;
      const hash = hashText(raw);
      const journal = asJournal(tx.get(journalKey));
      if (journal?.phase === 'claimed') return null;
      if (journal?.phase === 'consumed' && journal.hash === hash) return null;
      tx.put(journalKey, {
        phase: 'claimed',
        by: me.tab,
        instance: me.instance,
        dest,
        hash,
        payloadHash: payloadHash(parsed.payload),
        at: now,
      } satisfies LegacyJournal);
      return parsed;
    });
  } catch (error) {
    return { status: 'failed', reason: `draft coordination failed (${storageErrorReason(error)})` };
  }
  if (claimed === 'own') return { status: 'own' };
  if (!claimed) return { status: 'gone' };

  return finishTransfer(
    ctx,
    {
      dest,
      destParts,
      claimed,
      claim: (tx) => {
        const journal = asJournal(tx.get(journalKey));
        if (
          journal?.phase === 'consumed' &&
          journal.instance === me.instance &&
          journal.dest === dest
        )
          return 'done';
        if (!journal || journal.phase !== 'claimed' || journal.instance !== me.instance)
          return 'lost';
        return { held: journal };
      },
      release: (tx) => {
        const journal = asJournal(tx.get(journalKey));
        if (journal?.phase === 'claimed' && journal.instance === me.instance) tx.del(journalKey);
      },
      complete: (tx, journal) => {
        tx.put(journalKey, { ...journal, phase: 'consumed', at: ctx.now() } satisfies LegacyJournal);
        const current = ctx.local.get(legacyKey);
        if (current === null || hashText(current) !== journal.hash) return 'ok';
        return tryRemove(ctx.local, legacyKey) ? 'ok' : 'kept-source';
      },
      keptSourceWarning: 'the old copy could not be removed; it will not be offered again',
    },
    unchanged,
  );
}
