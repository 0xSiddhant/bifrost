/**
 * Desktop-only capability gate. The screensaver must never initialize on phones
 * or tablets — no canvas, no idle timers, no RAF. We require all three signals
 * so a laptop touchscreen or an iPad spoofing desktop Safari is still excluded:
 *  - a real hover-capable, fine pointer (mouse),
 *  - no touch points,
 *  - a viewport wide enough to be a computer.
 * (Straight from the PRD's device-detection guidance.)
 */
export interface DesktopEnv {
  matchMedia: (query: string) => Pick<MediaQueryList, 'matches'>;
  maxTouchPoints: number;
  innerWidth: number;
}

export const MIN_DESKTOP_WIDTH = 1024;

function defaultEnv(): DesktopEnv | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  return {
    matchMedia: (q) => window.matchMedia(q),
    maxTouchPoints: navigator.maxTouchPoints,
    innerWidth: window.innerWidth,
  };
}

export function isDesktopViewport(env: DesktopEnv | null = defaultEnv()): boolean {
  if (!env) return false;
  const finePointer = env.matchMedia('(hover: hover) and (pointer: fine)').matches;
  return finePointer && env.maxTouchPoints <= 0 && env.innerWidth >= MIN_DESKTOP_WIDTH;
}
