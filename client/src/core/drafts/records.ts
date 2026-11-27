/**
 * Draft records in `localStorage` (PLAN-43): one key per tab, editor and
 * workspace, so two tabs on the same editor never write the same value.
 *
 * Drafts stay in `localStorage` because it is synchronous: a `pagehide` flush
 * has to land before the page is gone, and an IndexedDB write started there
 * may not. What has to be consistent across tabs (who owns what, who is
 * closed, which transfer is claimed) lives in IndexedDB instead
 * (`coordinator.ts`): the PLAN-43 spike found that a tab can read another
 * tab's `localStorage` write a moment stale, even under a lock.
 */

import {
  RECORD_PREFIX,
  encodeKeyPart,
  type Departure,
  type DraftFeature,
} from './basics';

export {
  LEFT_PREFIX,
  OFFER_GRACE_MS,
  PRUNE_GRACE_MS,
  RECORD_PREFIX,
  departureValue,
  leftKey,
  randomId,
  type Departure,
  type DraftFeature,
} from './basics';

export const DRAFT_FEATURES: readonly DraftFeature[] = [
  'runestone',
  'edda',
  'groot',
  'atlas',
  'variant',
];

/** The unsaved editor. */
export const SCRATCH = 'scratch';
/** Variant's one workspace per tab: both its JSON and its text panes. */
export const VARIANT_WORKSPACE = 'main';

/** A saved document's unsaved working copy, by its stable id (a slug can change). */
export function docWorkspace(id: string): string {
  return `doc:${id}`;
}


export function recordKey(feature: DraftFeature, tab: string, workspace: string): string {
  return `${RECORD_PREFIX}${feature}.${encodeKeyPart(tab)}.${encodeKeyPart(workspace)}`;
}

export interface RecordKeyParts {
  feature: DraftFeature;
  tab: string;
  workspace: string;
}

export function parseRecordKey(key: string): RecordKeyParts | null {
  if (!key.startsWith(RECORD_PREFIX)) return null;
  const parts = key.slice(RECORD_PREFIX.length).split('.');
  if (parts.length !== 3) return null;
  const [feature, tab, workspace] = parts as [string, string, string];
  if (!(DRAFT_FEATURES as readonly string[]).includes(feature)) return null;
  try {
    return {
      feature: feature as DraftFeature,
      tab: decodeURIComponent(tab),
      workspace: decodeURIComponent(workspace),
    };
  } catch {
    // A malformed escape is somebody else's key, not a draft.
    return null;
  }
}


/** Validates a stored payload; null rejects it (the record is then ignored, never deleted). */
export type DraftCodec<P> = (raw: unknown) => P | null;

export interface DraftEnvelope<P> {
  v: 1;
  tab: string;
  feature: DraftFeature;
  workspace: string;
  savedAt: number;
  payload: P;
}

export function makeEnvelope<P>(
  parts: RecordKeyParts,
  payload: P,
  savedAt: number,
): DraftEnvelope<P> {
  return { v: 1, tab: parts.tab, feature: parts.feature, workspace: parts.workspace, savedAt, payload };
}

/**
 * A stored record, or null when it is missing, corrupt, of another schema
 * version, filed under the wrong key, or its payload fails the editor's codec.
 */
export function parseEnvelope<P>(
  raw: string | null,
  codec: DraftCodec<P>,
  expect: RecordKeyParts,
): DraftEnvelope<P> | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Partial<DraftEnvelope<unknown>>;
  if (
    record.v !== 1 ||
    record.tab !== expect.tab ||
    record.feature !== expect.feature ||
    record.workspace !== expect.workspace ||
    typeof record.savedAt !== 'number' ||
    !Number.isFinite(record.savedAt)
  ) {
    return null;
  }
  const payload = codec(record.payload);
  if (payload === null) return null;
  return { v: 1, tab: expect.tab, feature: expect.feature, workspace: expect.workspace, savedAt: record.savedAt, payload };
}


export function parseDeparture(raw: string | null): Departure | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<Departure>;
    if (typeof value.instance !== 'string' || typeof value.at !== 'number') return null;
    return { instance: value.instance, at: value.at };
  } catch {
    return null;
  }
}

/**
 * cyrb53: a fast 53-bit string hash. Used to tell whether a server document
 * still matches the one a draft was edited from, and whether a stored value
 * is the one a transfer claimed. Not a security boundary.
 */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
