import type { CoordBackend, CoordTx } from './coordinator';
import {
  LEFT_PREFIX,
  RECORD_PREFIX,
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

/** A departed tab's draft can be offered to another tab after this long. */
export const OFFER_GRACE_MS = 10_000;
/** …and pruned (when a newer draft for the same editor exists) after this long. */
export const PRUNE_GRACE_MS = 10 * 60_000;
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

/** Any stored payload, for verifying a destination by hash. */
const anyPayload: DraftCodec<unknown> = (raw) => (raw === undefined ? null : raw);
const payloadHash = (payload: unknown): string => hashText(JSON.stringify(payload));

function asTabEntry(value: unknown): TabEntry | null {
  const entry = value as Partial<TabEntry> | undefined;
  return entry && typeof entry.instance === 'string' ? (entry as TabEntry) : null;
}
function asGone(value: unknown): GoneEntry | null {
  const entry = value as Partial<GoneEntry> | undefined;
  return entry && (entry.phase === 'claimed' || entry.phase === 'done') ? (entry as GoneEntry) : null;
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

/** Start of a page lifetime: from now on this tab's earlier departure means nothing. */
export async function registerLifetime(ctx: ProtocolContext, me: Me): Promise<void> {
  await ctx.backend.run((tx) => {
    tx.put(tabEntryKey(me.tab), { instance: me.instance, at: ctx.now() } satisfies TabEntry);
    // Decisions about this tab's records were about an earlier lifetime.
    for (const key of tx.keys()) {
      if (!key.startsWith('gone:')) continue;
      const parts = parseRecordKey(key.slice('gone:'.length));
      if (parts?.tab === me.tab) tx.del(key);
    }
    tryRemove(ctx.local, leftKey(me.tab));
  });
}

/** Written last at `pagehide` (not persisted): synchronous, after every flush. */
export function writeDeparture(local: DraftStorage, me: Me, at: number): void {
  local.set(leftKey(me.tab), JSON.stringify({ instance: me.instance, at } satisfies Departure));
}

export interface FoundOffer<P> {
  key: string;
  envelope: DraftEnvelope<P>;
}

export interface OfferSearch<P> {
  offer: FoundOffer<P> | null;
  /** When a departure too recent to offer yet will be old enough. */
  recheckAt: number | null;
}

/**
 * The one draft a blank tab may be offered for this editor and workspace: the
 * first, in key order, whose tab is known closed and which nobody has claimed.
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
    let recheckAt: number | null = null;
    for (const record of listRecords(ctx.local)) {
      const { parts } = record;
      if (parts.feature !== feature || parts.workspace !== workspace || parts.tab === me.tab) continue;
      const departure = departed.get(parts.tab);
      if (!departure || tx.get(goneKey(record.key)) !== undefined) continue;
      const envelope = parseEnvelope(ctx.local.get(record.key), codec, parts);
      if (!envelope || !worth(envelope.payload)) continue;
      if (now - departure.at < OFFER_GRACE_MS) {
        const due = departure.at + OFFER_GRACE_MS;
        recheckAt = recheckAt === null ? due : Math.min(recheckAt, due);
        continue;
      }
      return { offer: { key: record.key, envelope }, recheckAt: null };
    }
    return { offer: null, recheckAt };
  });
}

export type AcceptResult<P> =
  | { status: 'ok'; payload: P; savedAt: number; warning?: string }
  | { status: 'gone' }
  | { status: 'failed'; reason: string };

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
 * Take a closed tab's draft into this tab, once: claim it, write and verify
 * this tab's copy, then mark the claim done and remove the source. A failed
 * write releases the claim and keeps the source; a lost claim removes the
 * copy, so two tabs never both restore it.
 */
export async function acceptOffer<P>(
  ctx: ProtocolContext,
  me: Me,
  sourceKey: string,
  codec: DraftCodec<P>,
): Promise<AcceptResult<P>> {
  const source = parseRecordKey(sourceKey);
  if (!source) return { status: 'gone' };
  const destParts: RecordKeyParts = { ...source, tab: me.tab };
  const dest = recordKey(source.feature, me.tab, source.workspace);

  let claimed: DraftEnvelope<P> | null;
  try {
    claimed = await ctx.backend.run((tx) => {
      const now = ctx.now();
      reconcileClaims(tx, ctx.local, now);
      const departure = confirmedDepartures(tx, ctx.local).get(source.tab);
      if (!departure || now - departure.at < OFFER_GRACE_MS) return null;
      if (tx.get(goneKey(sourceKey)) !== undefined) return null;
      const envelope = parseEnvelope(ctx.local.get(sourceKey), codec, source);
      if (!envelope) return null;
      tx.put(goneKey(sourceKey), {
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
  if (!claimed) return { status: 'gone' };

  const raw = JSON.stringify(makeEnvelope(destParts, claimed.payload, claimed.savedAt));
  const writeFailure = writeVerified(ctx.local, dest, raw);
  if (writeFailure) {
    await ctx.backend
      .run((tx) => {
        const gone = asGone(tx.get(goneKey(sourceKey)));
        if (gone?.phase === 'claimed' && gone.instance === me.instance) tx.del(goneKey(sourceKey));
      })
      .catch(() => {
        // The claim's lease runs out and reconciliation releases it: the
        // destination never verified, so the source stays.
      });
    return { status: 'failed', reason: writeFailure };
  }

  let outcome: 'ok' | 'lost' | 'kept-source';
  try {
    outcome = await ctx.backend.run((tx) => {
      const gone = asGone(tx.get(goneKey(sourceKey)));
      if (!gone || gone.phase !== 'claimed' || gone.instance !== me.instance) return 'lost';
      tx.put(goneKey(sourceKey), { ...gone, phase: 'done', at: ctx.now() } satisfies GoneEntry);
      if (!notReclaimed(tx, source.tab, gone.srcInstance)) return 'ok';
      return tryRemove(ctx.local, sourceKey) ? 'ok' : 'kept-source';
    });
  } catch (error) {
    // The copy is written and verified and the claim still names this tab:
    // reconciliation completes it, so the draft can be shown now.
    return {
      status: 'ok',
      payload: claimed.payload,
      savedAt: claimed.savedAt,
      warning: `the transfer could not be marked complete (${storageErrorReason(error)})`,
    };
  }
  if (outcome === 'lost') {
    tryRemove(ctx.local, dest);
    return { status: 'gone' };
  }
  return {
    status: 'ok',
    payload: claimed.payload,
    savedAt: claimed.savedAt,
    ...(outcome === 'kept-source'
      ? { warning: 'the other tab’s copy could not be removed; it will not be offered again' }
      : {}),
  };
}

export interface SweepFeature {
  codec: DraftCodec<unknown>;
}

/**
 * Prune closed tabs' drafts, newest first (owner, 2026-11-26). For each
 * editor: when this tab holds a valid draft of its own, every closed tab's
 * draft past the prune grace goes; otherwise the newest closed draft stays
 * and the older ones go. Only this tab's own records count as "a newer draft
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
      const ofFeature = records.filter((record) => record.parts.feature === feature);
      const own = ofFeature.filter(
        (record) =>
          record.parts.tab === me.tab &&
          parseEnvelope(ctx.local.get(record.key), spec.codec, record.parts) !== null,
      );
      const closed = ofFeature
        .map((record) => {
          const departure = departed.get(record.parts.tab);
          if (!departure || now - departure.at < OFFER_GRACE_MS) return null;
          if (tx.get(goneKey(record.key)) !== undefined) return null;
          const envelope = parseEnvelope(ctx.local.get(record.key), spec.codec, record.parts);
          return envelope ? { record, departure, savedAt: envelope.savedAt } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort(
          (a, b) =>
            b.departure.at - a.departure.at ||
            b.savedAt - a.savedAt ||
            (a.record.key < b.record.key ? -1 : 1),
        );
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

    // Housekeeping: tombstones whose record is gone, and departed tabs with
    // nothing left to decide about.
    const present = new Set(listRecords(ctx.local).map((record) => record.key));
    for (const key of tx.keys()) {
      if (!key.startsWith('gone:')) continue;
      const gone = asGone(tx.get(key));
      const source = key.slice('gone:'.length);
      if (!gone || gone.phase !== 'done') continue;
      if (!present.has(source)) {
        tx.del(key);
        continue;
      }
      const parts = parseRecordKey(source);
      if (parts && notReclaimed(tx, parts.tab, gone.srcInstance) && tryRemove(ctx.local, source)) {
        tx.del(key);
        present.delete(source);
      }
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
    tx.put(legacyJournalKey(feature), { ...journal, phase: 'consumed', at: now } satisfies LegacyJournal);
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
    if (raw === null) return null;
    const parsed = legacy.parse(raw);
    if (!parsed) return null;
    const journal = asJournal(tx.get(legacyJournalKey(feature)));
    if (journal?.phase === 'claimed') return null;
    if (journal?.phase === 'consumed' && journal.hash === hashText(raw)) return null;
    return parsed;
  });
}

/**
 * Take the pre-update draft into this tab's scratch workspace, once: journal
 * the claim and its destination, write and verify the copy, then mark the
 * journal consumed and remove the old key. The old value is never removed
 * before this tab's copy has read back, and never if it changed meanwhile.
 */
export async function acceptLegacy<P>(
  ctx: ProtocolContext,
  me: Me,
  feature: DraftFeature,
  workspace: string,
  legacy: LegacyParse<P>,
): Promise<AcceptResult<P>> {
  const legacyKey = LEGACY_KEYS[feature];
  if (!legacyKey) return { status: 'gone' };
  const destParts: RecordKeyParts = { feature, tab: me.tab, workspace };
  const dest = recordKey(feature, me.tab, workspace);

  let claimed: { payload: P; savedAt: number } | null;
  try {
    claimed = await ctx.backend.run((tx) => {
      const now = ctx.now();
      reconcileLegacy(tx, ctx.local, feature, legacyKey, now);
      const raw = ctx.local.get(legacyKey);
      if (raw === null) return null;
      const parsed = legacy.parse(raw);
      if (!parsed) return null;
      const hash = hashText(raw);
      const journal = asJournal(tx.get(legacyJournalKey(feature)));
      if (journal?.phase === 'claimed') return null;
      if (journal?.phase === 'consumed' && journal.hash === hash) return null;
      tx.put(legacyJournalKey(feature), {
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
  if (!claimed) return { status: 'gone' };

  const raw = JSON.stringify(makeEnvelope(destParts, claimed.payload, claimed.savedAt));
  const writeFailure = writeVerified(ctx.local, dest, raw);
  if (writeFailure) {
    await ctx.backend
      .run((tx) => {
        const journal = asJournal(tx.get(legacyJournalKey(feature)));
        if (journal?.phase === 'claimed' && journal.instance === me.instance)
          tx.del(legacyJournalKey(feature));
      })
      .catch(() => {
        // The lease runs out and reconciliation releases it: the copy never
        // verified, so the old key stays.
      });
    return { status: 'failed', reason: writeFailure };
  }

  let outcome: 'ok' | 'lost' | 'kept-source';
  try {
    outcome = await ctx.backend.run((tx) => {
      const journal = asJournal(tx.get(legacyJournalKey(feature)));
      if (!journal || journal.phase !== 'claimed' || journal.instance !== me.instance) return 'lost';
      tx.put(legacyJournalKey(feature), { ...journal, phase: 'consumed', at: ctx.now() } satisfies LegacyJournal);
      const current = ctx.local.get(legacyKey);
      if (current === null || hashText(current) !== journal.hash) return 'ok';
      return tryRemove(ctx.local, legacyKey) ? 'ok' : 'kept-source';
    });
  } catch (error) {
    return {
      status: 'ok',
      payload: claimed.payload,
      savedAt: claimed.savedAt,
      warning: `the transfer could not be marked complete (${storageErrorReason(error)})`,
    };
  }
  if (outcome === 'lost') {
    tryRemove(ctx.local, dest);
    return { status: 'gone' };
  }
  return {
    status: 'ok',
    payload: claimed.payload,
    savedAt: claimed.savedAt,
    ...(outcome === 'kept-source'
      ? { warning: 'the old copy could not be removed; it will not be offered again' }
      : {}),
  };
}
