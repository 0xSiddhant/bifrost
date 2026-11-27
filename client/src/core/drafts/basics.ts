/**
 * The few draft constants and helpers the first page load needs (PLAN-43):
 * every page starts the draft session, so a reloaded tab reclaims its id
 * wherever it lands. Everything else waits for an editor's chunk.
 */

export type DraftFeature = 'runestone' | 'edda' | 'groot' | 'atlas' | 'variant';

/** A departed tab's draft can be offered to another tab after this long. */
export const OFFER_GRACE_MS = 10_000;
/** …and pruned (when a newer draft for the same editor exists) after this long. */
export const PRUNE_GRACE_MS = 10 * 60_000;

export const RECORD_PREFIX = 'bifrost.drafts.v1.r.';
export const LEFT_PREFIX = 'bifrost.drafts.v1.left.';

export const encodeKeyPart = (part: string): string =>
  encodeURIComponent(part).replace(/\./g, '%2E');

export function leftKey(tab: string): string {
  return `${LEFT_PREFIX}${encodeKeyPart(tab)}`;
}

/** What a closing tab leaves behind: which page lifetime left, and when. */
export interface Departure {
  instance: string;
  at: number;
}

/** Written last at `pagehide` (not persisted): synchronous, after every flush. */
export function departureValue(instance: string, at: number): string {
  return JSON.stringify({ instance, at } satisfies Departure);
}

/** A random id, from `getRandomValues` (not gated on a secure context, unlike `randomUUID`). */
export function randomId(): string {
  try {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
  } catch {
    // Deliberately silent: a browser without `crypto` still gets a usable id.
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}
