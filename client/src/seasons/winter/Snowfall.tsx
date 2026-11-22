import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import './snowfall.css';

/**
 * Winter's sky decoration: snow falling behind every page. The `sky` slot
 * renders it when the applied theme turns it on (`--decor-snowfall`, Yule
 * does) and this device has not switched it off (Heimdall → Sky Relics);
 * otherwise it is not rendered at all.
 *
 * Every flake is its own element with its own physics, so the snow reads as
 * snow and not as a sheet of dots sliding down: a depth that sets its size,
 * speed, opacity and focus (near flakes are large, quick and soft; far ones
 * small, slow and faint), its own sway, and for the nearer ones a six-armed
 * crystal that tumbles as it falls. Wind gusts push the near field further
 * than the far one. Every animation moves `translate` or `transform` only,
 * so it runs on the compositor (the PLAN-40 rule), and no script runs per
 * frame. Reduced motion leaves the flakes where they are.
 *
 * ⚠️ The flakes are Web Animations (`element.animate`), not CSS animations.
 * React listens for `animationiteration` at its root, and while anything
 * listens Chrome must wake the main thread to fire that event whenever any
 * CSS animation completes an iteration: with ~350 short looping animations
 * that was ~45 wake-ups a second, each restyling every animated element
 * (measured: 0.9 s of main-thread work in every 3 s, against 18 ms for the
 * same animations with no script on the page). Web Animations fire no
 * iteration events, so the compositor runs them alone. The wind gusts on the
 * two fields stay CSS: two animations with 20-second iterations cost nothing.
 *
 * ⚠️ No CSS `filter` on a flake (no `blur()`, no `drop-shadow()`): an engine
 * that composites in software, as WebKit does in CI's headless containers,
 * re-applies a moving layer's filter every frame, and a hundred of them
 * starved its animation frames for seconds. The soft edge, the rim that
 * shows white snow on a white page and the near flakes' focus are all drawn
 * into the flake's own gradient (snowfall.css).
 */

export interface Flake {
  /** Left edge, in vw; a little past both edges so a gust never bares one. */
  x: number;
  /** Resting top, in vh: where it stands when motion is reduced. */
  y: number;
  /** 0 = far … 1 = near. */
  depth: number;
  /** Diameter in px. */
  size: number;
  /** Seconds to fall the height of the screen. */
  fall: number;
  /** Negative start offset, so the sky is already full when it appears. */
  delay: number;
  /** Sway amplitude in px, and its half-period in seconds. */
  sway: number;
  swayTime: number;
  swayDelay: number;
  alpha: number;
  /** Depth of field, 0 (sharp) to 1 (softest): only the nearest flakes are
   *  out of focus. Drawn into the flake's own gradient, not by a filter. */
  soft: number;
  /** Index into `CRYSTALS`, or null for a soft round flake. */
  crystal: number | null;
  /** Seconds per tumble, and which way it turns. */
  spin: number;
  spinReverse: boolean;
}

/** How many flakes a viewport gets: denser on a large screen, never sparse. */
export function flakeCount(width: number, height: number): number {
  return Math.round(Math.min(180, Math.max(50, (width * height) / 7000)));
}

/** A flake at depth ≥ this may be a crystal; smaller ones are soft dots. */
export const CRYSTAL_DEPTH = 0.55;

/** The flakes of one sky. `rng` is injectable so tests are deterministic. */
export function makeFlakes(count: number, rng: () => number = Math.random): Flake[] {
  const flakes: Flake[] = [];
  for (let i = 0; i < count; i += 1) {
    // More far flakes than near ones, as in a real snowfall, but few mere specks.
    const depth = rng() ** 1.15;
    const fall = (21 - depth * 11) * (0.85 + rng() * 0.3);
    const swayTime = 3 + rng() * 4;
    const crystal =
      depth >= CRYSTAL_DEPTH && rng() < 0.6 ? Math.floor(rng() * CRYSTALS.length) : null;
    const spin = 7 + rng() * 10;
    flakes.push({
      x: -5 + rng() * 110,
      y: rng() * 100,
      depth,
      size: 3.5 + depth ** 1.3 * 15,
      fall,
      delay: -rng() * fall,
      sway: 8 + depth * 30 + rng() * 10,
      swayTime,
      swayDelay: -rng() * swayTime,
      alpha: 0.7 + depth * 0.3,
      soft: depth > 0.82 ? (depth - 0.82) / 0.18 : 0,
      crystal,
      spin,
      spinReverse: rng() < 0.5,
    });
  }
  return flakes;
}

/** A flake at depth ≥ this rides the near field, which the wind pushes harder. */
export const NEAR_DEPTH = 0.6;

const CENTRE = 12;
const point = (radius: number, degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  return `${(CENTRE + radius * Math.cos(a)).toFixed(2)} ${(CENTRE + radius * Math.sin(a)).toFixed(2)}`;
};
const ARMS = [0, 60, 120, 180, 240, 300].map((d) => d - 90);

/** A six-armed crystal: arms of `arm` units, with branch pairs at `branches`. */
function crystalPath(arm: number, branches: [at: number, length: number, angle: number][]): string {
  return ARMS.map((a) => {
    const segments = [`M${point(0, a)}L${point(arm, a)}`];
    for (const [at, length, angle] of branches) {
      const base = point(at, a);
      const [bx, by] = base.split(' ').map(Number) as [number, number];
      for (const turn of [-angle, angle]) {
        const t = ((a + turn) * Math.PI) / 180;
        segments.push(
          `M${base}L${(bx + length * Math.cos(t)).toFixed(2)} ${(by + length * Math.sin(t)).toFixed(2)}`,
        );
      }
    }
    return segments.join('');
  }).join('');
}

/** Three crystal designs in a 24-unit box: a fern star, a stellar plate, a needle star. */
export const CRYSTALS: readonly string[] = [
  crystalPath(10, [
    [4.5, 2.6, 55],
    [7.2, 2.2, 55],
  ]),
  crystalPath(9.5, [[5.5, 3.4, 60]]),
  crystalPath(10.5, [[8.2, 1.8, 45]]),
];

export function Snowfall() {
  // One sky per mount: a theme switch or the device switch remounts it, a resize
  // does not (positions are in vw/vh, so it still fills the screen).
  const flakes = useMemo(() => makeFlakes(flakeCount(window.innerWidth, window.innerHeight)), []);
  const sky = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = sky.current;
    if (!root) return undefined;
    return animateFlakes(root, flakes);
  }, [flakes]);

  return (
    <div ref={sky} className="snowfall" aria-hidden="true">
      {(['far', 'near'] as const).map((field) => (
        <div key={field} className={`snowfall__field snowfall__field--${field}`}>
          {flakes
            .filter((flake) => (flake.depth >= NEAR_DEPTH ? 'near' : 'far') === field)
            .map((flake, i) => (
              <span key={i} className="snowflake" style={flakeStyle(flake)}>
                <span className="snowflake__sway">
                  {flake.crystal === null ? (
                    <span className="snowflake__body snowflake__body--round" />
                  ) : (
                    <svg className="snowflake__body snowflake__body--crystal" viewBox="0 0 24 24">
                      <path className="snowflake__rim" d={CRYSTALS[flake.crystal]} />
                      <path className="snowflake__ice" d={CRYSTALS[flake.crystal]} />
                    </svg>
                  )}
                </span>
              </span>
            ))}
        </div>
      ))}
    </div>
  );
}

function flakeStyle(flake: Flake): CSSProperties {
  return {
    '--x': `${flake.x.toFixed(2)}vw`,
    '--y': `${flake.y.toFixed(2)}vh`,
    '--size': `${flake.size.toFixed(1)}px`,
    '--alpha': flake.alpha.toFixed(2),
    '--soft': flake.soft.toFixed(2),
  } as CSSProperties;
}

/**
 * Starts every flake's fall, sway and tumble as Web Animations with literal
 * keyframes, and returns the stop. Nothing starts under reduced motion: the
 * flakes then rest where they stand (`top: var(--y)`). jsdom has no
 * `element.animate`, so tests see the static sky.
 */
export function animateFlakes(root: HTMLElement, flakes: readonly Flake[]): () => void {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced || typeof root.animate !== 'function') return () => {};
  const running: Animation[] = [];
  const nodes = root.querySelectorAll<HTMLElement>('.snowflake');
  // The fields render far flakes first, then near ones: map back by depth.
  const ordered = [
    ...flakes.filter((flake) => flake.depth < NEAR_DEPTH),
    ...flakes.filter((flake) => flake.depth >= NEAR_DEPTH),
  ];
  nodes.forEach((node, i) => {
    const flake = ordered[i];
    const sway = node.firstElementChild as HTMLElement | null;
    const body = sway?.firstElementChild as HTMLElement | null;
    if (!flake || !sway || !body) return;
    // From just above the screen to just below it, wherever it rests.
    const top = -(flake.y + 4);
    const bottom = 104 - flake.y;
    running.push(
      node.animate(
        [{ translate: `0 ${top.toFixed(2)}vh` }, { translate: `0 ${bottom.toFixed(2)}vh` }],
        {
          id: 'snow-fall',
          duration: flake.fall * 1000,
          delay: flake.delay * 1000,
          iterations: Infinity,
          easing: 'linear',
        },
      ),
      sway.animate(
        [
          { translate: `${(-flake.sway).toFixed(1)}px 0` },
          { translate: `${flake.sway.toFixed(1)}px 0` },
        ],
        {
          id: 'snow-sway',
          duration: flake.swayTime * 1000,
          delay: flake.swayDelay * 1000,
          iterations: Infinity,
          direction: 'alternate',
          easing: 'ease-in-out',
        },
      ),
    );
    if (flake.crystal !== null) {
      running.push(
        body.animate(
          [
            { transform: 'perspective(40px) rotate3d(0.35, 1, 0.2, 0deg)' },
            { transform: 'perspective(40px) rotate3d(0.35, 1, 0.2, 360deg)' },
          ],
          {
            id: 'snow-tumble',
            duration: flake.spin * 1000,
            iterations: Infinity,
            direction: flake.spinReverse ? 'reverse' : 'normal',
          },
        ),
      );
    }
  });
  return () => {
    for (const animation of running) animation.cancel();
  };
}
