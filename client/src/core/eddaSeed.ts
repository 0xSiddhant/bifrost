/**
 * A one-shot document hand-off into Edda's scratch editor (PLAN-25).
 * Carries Markdown that Brotli decompressed and recognised.
 *
 * Same bridge `runestoneSeed.ts` established for Groot's own "Open in
 * Runestone": Edda addresses saved documents by slug, which cannot carry a
 * document that has never been saved, so the text travels through
 * sessionStorage instead. Route-level, read once on mount — no cross-feature
 * import in either direction.
 */

const SEED_KEY = 'bifrost.edda.seed';

export interface EddaSeed {
  title: string;
  text: string;
}

export function putEddaSeed(seed: EddaSeed): void {
  try {
    sessionStorage.setItem(SEED_KEY, JSON.stringify(seed));
  } catch {
    // sessionStorage can be unavailable (private mode); the editor just opens empty.
  }
}

/** Read and clear the seed — it applies exactly once per navigation. */
export function takeEddaSeed(): EddaSeed | null {
  try {
    const raw = sessionStorage.getItem(SEED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SEED_KEY);
    const parsed = JSON.parse(raw) as Partial<EddaSeed>;
    if (typeof parsed.text !== 'string') return null;
    return { title: typeof parsed.title === 'string' ? parsed.title : '', text: parsed.text };
  } catch {
    return null;
  }
}
