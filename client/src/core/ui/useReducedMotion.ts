import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null;
}

function subscribe(onChange: () => void): () => void {
  const list = media();
  if (!list) return () => {};
  // Safari before 14 has only the older listener API.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  list.addListener(onChange);
  return () => list.removeListener(onChange);
}

const reducedNow = () => media()?.matches ?? false;

/**
 * Whether the visitor asks for reduced motion, kept current: it changes the
 * moment the setting does, with the page open. `base.css` stills every CSS
 * animation by a media query, which is always live; a Web Animation is started
 * by script, so the effect that starts one depends on this and stops it (and
 * starts it again) when the answer changes. False where `matchMedia` is
 * missing (jsdom).
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedNow, () => false);
}
