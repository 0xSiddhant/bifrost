/**
 * Click ripples for the screensaver. Short-lived expanding rings spawned at the
 * pointer; the array is advanced each frame and expired ripples are dropped so
 * nothing accumulates. Pure + testable — the canvas reads `rippleRadius` /
 * `rippleAlpha` to paint.
 */
export const RIPPLE_LIFE_MS = 1400;
const MAX_RADIUS = 260;

export interface Ripple {
  x: number;
  y: number;
  /** Elapsed lifetime in ms. */
  age: number;
  /** Total lifetime in ms. */
  life: number;
  /** True when this ripple came from the dismissing click (drawn a touch bolder). */
  dismiss: boolean;
}

export function spawnRipple(x: number, y: number, dismiss = false): Ripple {
  return { x, y, age: 0, life: RIPPLE_LIFE_MS, dismiss };
}

/** Age every ripple by `dtMs` and return only those still alive (new array). */
export function advanceRipples(ripples: readonly Ripple[], dtMs: number): Ripple[] {
  const next: Ripple[] = [];
  for (const r of ripples) {
    const aged = { ...r, age: r.age + dtMs };
    if (aged.age < aged.life) next.push(aged);
  }
  return next;
}

/** Progress 0..1 through the ripple's life. */
export function rippleProgress(r: Ripple): number {
  return Math.min(1, r.age / r.life);
}

/** Eased expanding radius in px. */
export function rippleRadius(r: Ripple): number {
  const t = rippleProgress(r);
  // easeOutCubic
  const eased = 1 - Math.pow(1 - t, 3);
  return eased * MAX_RADIUS * (r.dismiss ? 1.25 : 1);
}

/** Fading opacity 0..1 (fades out as it expands). */
export function rippleAlpha(r: Ripple): number {
  const t = rippleProgress(r);
  return (1 - t) * (r.dismiss ? 0.9 : 0.7);
}
