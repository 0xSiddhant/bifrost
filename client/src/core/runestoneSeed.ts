/**
 * A one-shot document hand-off into Runestone's scratch editor (Groot's
 * "Open in Runestone" — PLAN-19). Runestone addresses saved documents by slug,
 * which cannot carry a document that has never been saved, so the converted
 * JSON travels through sessionStorage instead — the same bridge Loki→Variant
 * established in `core/variantSeed`. Still route-level: Groot writes, navigates
 * to `/runestone`, and Runestone reads it once on mount. No cross-feature import.
 */

import { asJsonFormat, type JsonFormat } from './json';

const SEED_KEY = 'bifrost.runestone.seed';

export interface RunestoneSeed {
  title: string;
  text: string;
  /**
   * The format to open it in (PLAN-42). Optional for the senders that only
   * ever hand over strict JSON (Groot's conversion); absent reads as JSON.
   */
  format?: JsonFormat;
}

export function putRunestoneSeed(seed: RunestoneSeed): void {
  try {
    sessionStorage.setItem(SEED_KEY, JSON.stringify(seed));
  } catch {
    // sessionStorage can be unavailable (private mode); the editor just opens empty.
  }
}

/** Read and clear the seed — it applies exactly once per navigation. */
export function takeRunestoneSeed(): RunestoneSeed | null {
  try {
    const raw = sessionStorage.getItem(SEED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SEED_KEY);
    const parsed = JSON.parse(raw) as Partial<RunestoneSeed>;
    if (typeof parsed.text !== 'string') return null;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      text: parsed.text,
      format: asJsonFormat(parsed.format),
    };
  } catch {
    return null;
  }
}
