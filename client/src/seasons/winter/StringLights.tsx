import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../../core/ui/useReducedMotion';
import './string-lights.css';

/**
 * Winter's header decoration: a strand of Christmas lights hanging below the
 * header at the top of every page, rendered by the `header` slot when the
 * applied theme turns it on (`--decor-string-lights`).
 * It sits in the empty space every page leaves under the header and scrolls
 * away under it, so it never covers text, nor Accio's and Portkey's bars that
 * park below the sticky header. The bulbs are the theme's own accent,
 * accent-2, ok and warn colours, one layer per colour, each twinkling by
 * opacity alone.
 *
 * The twinkle is a Web Animation, not a CSS one, for the reason the snowfall
 * gives (Snowfall.tsx): a short looping CSS animation fires an iteration
 * event every cycle, and each one woke the main thread to restyle every
 * falling flake (measured: 239 ms of every 3 s with a CSS twinkle, 15 ms
 * without).
 */
/** Each colour's twinkle, in seconds: its half-period and its start offset. */
const TWINKLE: readonly (readonly [number, number])[] = [
  [1.7, 0],
  [2.3, -0.6],
  [1.9, -1.1],
  [2.6, -0.3],
];

export function StringLights() {
  const strand = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = strand.current;
    if (!root || typeof root.animate !== 'function' || reduced) return undefined;
    const running = [...root.querySelectorAll<HTMLElement>('.string-lights__bulbs')].map(
      (layer, i) => {
        const [half, delay] = TWINKLE[i % TWINKLE.length] ?? [2, 0];
        return layer.animate([{ opacity: 1 }, { opacity: 0.38 }], {
          id: 'lights-twinkle',
          duration: half * 1000,
          delay: delay * 1000,
          iterations: Infinity,
          direction: 'alternate',
          easing: 'ease-in-out',
        });
      },
    );
    return () => {
      for (const animation of running) animation.cancel();
    };
  }, [reduced]);

  return (
    <div ref={strand} className="string-lights" aria-hidden="true">
      <span className="string-lights__wire" />
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`string-lights__bulbs string-lights__bulbs--${n}`} />
      ))}
    </div>
  );
}
