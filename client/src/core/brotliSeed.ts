/**
 * A one-shot text hand-off into the Brotli page (PLAN-25) — the outbound half
 * of the two hand-offs that plan adds, carrying whatever a single-buffer editor
 * currently holds.
 *
 * Same bridge `runestoneSeed.ts` and `variantSeed.ts` already established: the
 * Brotli page has no URL that can carry a document, so the text travels through
 * sessionStorage and is read once on mount. Route-level, so none of the five
 * senders imports the Brotli feature and it imports none of them.
 *
 * Unlike Groot's pre-fill-and-wait into Runestone, arrival here compresses
 * immediately — the content was chosen to be compressed, so a second click to
 * confirm that would only be a step in the way (Loki→Variant's own immediacy).
 */

const SEED_KEY = 'bifrost.brotli.seed';

export interface BrotliSeed {
  text: string;
  /** Which tool sent it — the page says so ("sent from Runestone"). */
  sourceLabel?: string;
}

export function putBrotliSeed(seed: BrotliSeed): void {
  try {
    sessionStorage.setItem(SEED_KEY, JSON.stringify(seed));
  } catch {
    // sessionStorage can be unavailable (private mode); the page just opens empty.
  }
}

/** Read and clear the seed — it applies exactly once per navigation. */
export function takeBrotliSeed(): BrotliSeed | null {
  try {
    const raw = sessionStorage.getItem(SEED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SEED_KEY);
    const parsed = JSON.parse(raw) as Partial<BrotliSeed>;
    if (typeof parsed.text !== 'string') return null;
    return {
      text: parsed.text,
      ...(typeof parsed.sourceLabel === 'string' && { sourceLabel: parsed.sourceLabel }),
    };
  } catch {
    return null;
  }
}
