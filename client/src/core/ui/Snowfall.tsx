import { useMemo, type CSSProperties } from 'react';
import { useSnowfallEnabled, useThemeOptIn } from './useThemeOptIn';
import './snowfall.css';

/**
 * Snow falling behind every page, in a theme that turns it on with
 * `--snow-alpha` (the Yule world), unless this device switched it off in
 * Heimdall → Sky Relics. Not rendered at all otherwise.
 *
 * Every flake is its own element with its own physics, so the snow reads as
 * snow and not as a sheet of dots sliding down: a depth that sets its size,
 * speed, opacity and focus (near flakes are large, quick and soft; far ones
 * small, slow and faint), its own sway, and for the nearer ones a six-armed
 * crystal that tumbles as it falls. Wind gusts push the near field further
 * than the far one. All of it is CSS animation of `translate`, `transform`
 * and nothing else, so it runs on the compositor (the PLAN-40 rule): no
 * script runs per frame. Reduced motion leaves the flakes where they are.
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
  /** Depth-of-field blur, in px: only the nearest flakes are out of focus. */
  blur: number;
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
      blur: depth > 0.82 ? (depth - 0.82) * 7 : 0,
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
  const level = useThemeOptIn('--snow-alpha');
  const enabled = useSnowfallEnabled();
  // One sky per mount: a theme switch or the switch remounts it, a resize
  // does not (positions are in vw/vh, so it still fills the screen).
  const flakes = useMemo(() => makeFlakes(flakeCount(window.innerWidth, window.innerHeight)), []);
  if (level === 0 || !enabled) return null;
  return (
    <div className="snowfall" aria-hidden="true">
      {(['far', 'near'] as const).map((field) => (
        <div key={field} className={`snowfall__field snowfall__field--${field}`}>
          {flakes
            .filter((flake) => (flake.depth >= NEAR_DEPTH ? 'near' : 'far') === field)
            .map((flake, i) => (
              <span key={i} className="snowflake" style={flakeStyle(flake)}>
                <span className="snowflake__sway">
                  {flake.crystal === null ? (
                    <span className="snowflake__body" />
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
    '--fall': `${flake.fall.toFixed(2)}s`,
    '--delay': `${flake.delay.toFixed(2)}s`,
    '--sway': `${flake.sway.toFixed(1)}px`,
    '--sway-t': `${flake.swayTime.toFixed(2)}s`,
    '--sway-delay': `${flake.swayDelay.toFixed(2)}s`,
    '--alpha': flake.alpha.toFixed(2),
    '--blur': `${flake.blur.toFixed(2)}px`,
    '--spin': `${flake.spin.toFixed(2)}s`,
    '--spin-dir': flake.spinReverse ? 'reverse' : 'normal',
  } as CSSProperties;
}
