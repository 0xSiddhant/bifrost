/**
 * A one-shot document hand-off into Atlas's scratch editor (PLAN-25).
 * Carries XML that Brotli decompressed and recognised.
 *
 * Same bridge `runestoneSeed.ts` established for Groot's own "Open in
 * Runestone": Atlas addresses saved documents by slug, which cannot carry a
 * document that has never been saved, so the text travels through
 * sessionStorage instead. Route-level, read once on mount — no cross-feature
 * import in either direction.
 */

const SEED_KEY = 'bifrost.atlas.seed';

export interface AtlasSeed {
  title: string;
  text: string;
}

export function putAtlasSeed(seed: AtlasSeed): void {
  try {
    sessionStorage.setItem(SEED_KEY, JSON.stringify(seed));
  } catch {
    // sessionStorage can be unavailable (private mode); the editor just opens empty.
  }
}

/** Read and clear the seed — it applies exactly once per navigation. */
export function takeAtlasSeed(): AtlasSeed | null {
  try {
    const raw = sessionStorage.getItem(SEED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SEED_KEY);
    const parsed = JSON.parse(raw) as Partial<AtlasSeed>;
    if (typeof parsed.text !== 'string') return null;
    return { title: typeof parsed.title === 'string' ? parsed.title : '', text: parsed.text };
  } catch {
    return null;
  }
}
