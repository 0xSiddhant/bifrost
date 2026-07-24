/**
 * Pure particle-field engine for the Nótt screensaver. No DOM, no canvas — it
 * only owns positions/velocities so it is deterministic and unit-testable with
 * an injected RNG. The overlay component drives it (`step` each frame) and
 * paints the result.
 *
 * The field is a **world larger than the viewport**: moving the cursor pans a
 * per-depth camera across it (`DEPTH_PAN`), so turning toward an edge scrolls
 * the stars and brings new ones into view — like standing among the stars and
 * turning your head. Three depth layers give parallax: layer 0 is the farthest
 * (many small, dim, slow stars — and the only layer that draws connecting
 * lines), layer 2 the nearest (few bright "suns", which swing the most).
 */
import type { MotionBand, ParticleDensity } from '../../core/screensaver';

export const LAYERS = 4;

/** Visible particle count per density band (per viewport; scaled up to fill the
 *  larger world so the on-screen density matches). */
const COUNTS: Record<ParticleDensity, number> = { low: 120, medium: 175, high: 240 };

/** Drift-speed multiplier per motion band. */
const MOTION_SPEED: Record<MotionBand, number> = { calm: 0.55, normal: 1, lively: 1.7 };

/** Base drift speed in px per second at motion=normal, before the depth scale. */
const BASE_DRIFT = 8;

/** Max camera pan as a fraction of the viewport dimension (at reference depth). */
export const PAN_FRACTION = 0.32;
/** Pan multiplier per depth — far layer barely moves, near "suns" swing most.
 *  One entry per layer (far → near). */
export const DEPTH_PAN = [0.45, 0.8, 1.2, 1.8] as const;
/** Depth distribution (per layer, far → near): mostly far stars, fewer near suns.
 *  Must have LAYERS entries and sum to ~1. */
const DEPTH_WEIGHT = [0.4, 0.29, 0.19, 0.12] as const;

/** Pairwise distance (px) under which far-layer particles get a connecting line. */
export const LINK_DISTANCE = 96;

/**
 * Focus vignette (the "helmet porthole"): particles within FOCUS_INNER of the
 * screen centre (normalized radius) are fully sharp/opaque; past FOCUS_OUTER
 * they've faded to nothing. Between, they dim + soften — keeping the centre
 * dense and dark while the edges thin out and blur.
 */
export const FOCUS_INNER = 0.24;
export const FOCUS_OUTER = 1.05;

/** 1 at the centre → 0 out past the rim, with a smooth falloff. */
export function focusFactor(
  screenX: number,
  screenY: number,
  width: number,
  height: number,
): number {
  const nx = (screenX - width / 2) / (width / 2);
  const ny = (screenY - height / 2) / (height / 2);
  const r = Math.hypot(nx, ny);
  const t = Math.min(1, Math.max(0, (r - FOCUS_INNER) / (FOCUS_OUTER - FOCUS_INNER)));
  const smooth = t * t * (3 - 2 * t); // smoothstep
  return 1 - smooth;
}

export interface Particle {
  /** World coordinates in [0, worldW] × [0, worldH]. */
  x: number;
  y: number;
  /** px/sec. */
  vx: number;
  vy: number;
  /** 0 = far … LAYERS-1 = near. */
  depth: number;
  /** Radius in px — depth-scaled *and* individually jittered (no two alike). */
  size: number;
  /** 0..1 base opacity (depth-scaled). */
  alpha: number;
  /** Twinkle phase offset (radians) so pulses don't sync. */
  phase: number;
  /** Twinkle/grow speed (radians per ms). */
  twinkle: number;
}

export interface Field {
  particles: Particle[];
  /** Viewport size the world was built around. */
  width: number;
  height: number;
  /** World size (viewport + panning margin on every side). */
  worldW: number;
  worldH: number;
  /** Half the world-minus-viewport margin — the centering/pan offset. */
  padX: number;
  padY: number;
  /** Max pan in px per axis (the camera multiplies this by DEPTH_PAN). */
  panX: number;
  panY: number;
}

export interface CreateFieldOptions {
  width: number;
  height: number;
  density: ParticleDensity;
  motion: MotionBand;
  /** Injectable for deterministic tests; defaults to Math.random. */
  rng?: () => number;
}

function pickDepth(r: number): number {
  let acc = 0;
  for (let d = 0; d < DEPTH_WEIGHT.length; d += 1) {
    acc += DEPTH_WEIGHT[d] ?? 0;
    if (r < acc) return d;
  }
  return LAYERS - 1;
}

export function createField(options: CreateFieldOptions): Field {
  const { width, height, density, motion, rng = Math.random } = options;
  const speed = MOTION_SPEED[motion];
  const maxMult = Math.max(...DEPTH_PAN);
  const panX = width * PAN_FRACTION;
  const panY = height * PAN_FRACTION;
  // The world extends past the viewport by the farthest a layer can pan (plus a
  // little for particle size), so a full head-turn never reveals a bare edge.
  const padX = panX * maxMult + 60;
  const padY = panY * maxMult + 60;
  const worldW = width + padX * 2;
  const worldH = height + padY * 2;
  // Scale the count so the *visible* density matches the band despite the world
  // being bigger than the viewport.
  const areaFactor = (worldW * worldH) / (width * height);
  const count = Math.round(COUNTS[density] * areaFactor);

  const particles: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const depth = pickDepth(rng());
    // Near layers are bigger, brighter, faster.
    const depthScale = (depth + 1) / LAYERS;
    const angle = rng() * Math.PI * 2;
    const magnitude = BASE_DRIFT * speed * (0.4 + depthScale);
    // Per-particle size jitter so no two dots match — deep ones stay small,
    // near ones large, but all across a continuous range.
    const sizeJitter = 0.6 + rng() * 0.95;
    particles.push({
      x: rng() * worldW,
      y: rng() * worldH,
      vx: Math.cos(angle) * magnitude,
      vy: Math.sin(angle) * magnitude,
      depth,
      size: (0.5 + depthScale * 2.3) * sizeJitter,
      alpha: 0.22 + depthScale * 0.55,
      phase: rng() * Math.PI * 2,
      twinkle: 0.0006 + rng() * 0.0018,
    });
  }
  return { particles, width, height, worldW, worldH, padX, padY, panX, panY };
}

/** Advance the field by `dtMs` milliseconds (drift + world wrap). Mutates + returns it. */
export function step(field: Field, dtMs: number): Field {
  const dt = dtMs / 1000;
  const { worldW, worldH } = field;
  for (const p of field.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // Toroidal wrap in world space so the field never depletes.
    if (p.x < 0) p.x += worldW;
    else if (p.x > worldW) p.x -= worldW;
    if (p.y < 0) p.y += worldH;
    else if (p.y > worldH) p.y -= worldH;
  }
  return field;
}

/**
 * Ease a normalized cursor offset (−1..1) into a pan factor: gentle near the
 * centre, decisive toward the edges (signed square). Keeps the sky stable when
 * the cursor is roughly centred, then "turns your head" as you reach out.
 */
export function easePan(n: number): number {
  const c = Math.max(-1, Math.min(1, n));
  return c * Math.abs(c);
}

export interface Link {
  a: Particle;
  b: Particle;
  /** 0..1 — 1 when touching, 0 at the link threshold. */
  strength: number;
}

/**
 * Connecting lines for the far layer (depth 0) only. O(n²) over just that layer,
 * which — while it's the largest layer — is still a fraction of the field.
 */
export function nearPairs(field: Field, threshold = LINK_DISTANCE): Link[] {
  const far = field.particles.filter((p) => p.depth === 0);
  const links: Link[] = [];
  for (let i = 0; i < far.length; i += 1) {
    for (let j = i + 1; j < far.length; j += 1) {
      const a = far[i];
      const b = far[j];
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist < threshold) links.push({ a, b, strength: 1 - dist / threshold });
    }
  }
  return links;
}
