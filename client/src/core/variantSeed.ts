/**
 * A one-shot text hand-off into Variant's text mode (Loki's "Diff before/after"
 * — PLAN-12). Variant's `?left/?right` URL params resolve *runestone slugs*
 * into the JSON panes, which cannot carry arbitrary before/after JS text, so
 * Loki seeds the two text panes through sessionStorage instead. Still
 * route/URL-level: Loki writes, navigates to `/variant`, and Variant reads it
 * once on mount — no cross-feature import.
 */

const SEED_KEY = 'bifrost.variant.textSeed';

export interface VariantTextSeed {
  left: string;
  right: string;
}

export function putVariantTextSeed(seed: VariantTextSeed): void {
  try {
    sessionStorage.setItem(SEED_KEY, JSON.stringify(seed));
  } catch {
    // sessionStorage can be unavailable (private mode); the diff just won't seed.
  }
}

/** Read and clear the seed — it applies exactly once per navigation. */
export function takeVariantTextSeed(): VariantTextSeed | null {
  try {
    const raw = sessionStorage.getItem(SEED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SEED_KEY);
    const parsed = JSON.parse(raw) as Partial<VariantTextSeed>;
    if (typeof parsed.left !== 'string' || typeof parsed.right !== 'string') return null;
    return { left: parsed.left, right: parsed.right };
  } catch {
    return null;
  }
}
