import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreensaverConfig } from '../../core/screensaver';
import { bifrostEvents } from '../../core/sse';
import { MoonIcon } from '../../core/ui/icons';
import { pickRandomQuote, WORLD_LABELS, type Quote } from '../../assets/quotes';
import {
  createField,
  nearPairs,
  step,
  easePan,
  focusFactor,
  LAYERS,
  DEPTH_PAN,
  type Field,
} from './particles';
import {
  advanceRipples,
  rippleAlpha,
  rippleRadius,
  spawnRipple,
  type Ripple,
} from './ripple';
import './screensaver.css';

const FRAME_MS = 1000 / 30; // 30fps cap — this is a background flourish.
const RESIZE_DEBOUNCE_MS = 180;
/** How fast the camera eases toward the cursor target (0..1 per frame) — the
 *  "turning your head" momentum rather than a 1:1 jump. */
const CAMERA_EASE = 0.09;

interface ScreensaverColors {
  veil: string;
  particle: string;
  particle2: string;
  line: string;
  ripple: string;
  glow: string;
}

function readColors(): ScreensaverColors {
  const s = getComputedStyle(document.documentElement);
  const read = (...names: string[]): string => {
    for (const name of names) {
      const value = s.getPropertyValue(name).trim();
      if (value) return value;
    }
    return '';
  };
  return {
    veil: read('--screen-veil', '--bg') || 'rgba(6,8,14,0.96)',
    particle: read('--screen-particle', '--stars') || 'rgba(233,237,245,0.7)',
    particle2: read('--screen-particle-2', '--accent-2', '--accent') || '#8b7cf6',
    line: read('--screen-line', '--accent') || '#2dd4bf',
    ripple: read('--screen-ripple', '--accent') || '#2dd4bf',
    glow: read('--screen-glow', '--accent-2', '--accent') || '#8b7cf6',
  };
}

export interface ScreensaverProps {
  config: ScreensaverConfig;
  onDismiss: () => void;
}

/**
 * The Nótt idle overlay: a full-viewport particle constellation with a branded
 * header + live clock and a random lore quote floating above. Dismissed by a
 * click (a ripple lands, then it fades) or a keystroke; mousemove only pushes
 * the particles around. Desktop-only and mounted only when idle — the whole
 * component (and its RAF loop) simply doesn't exist otherwise, so nothing burns
 * CPU in the background.
 */
export function Screensaver({ config, onDismiss }: ScreensaverProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const [quote, setQuote] = useState<Quote>(() => pickRandomQuote());
  const [clock, setClock] = useState<string>('');
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Dismissal choreography: a click spawns a ripple then fades out; a keystroke
  // fades fast. Guarded so it only runs once.
  const beginDismiss = useCallback(
    (withRipple: boolean, point?: { x: number; y: number }) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      const fadeThenDismiss = () => {
        setLeaving(true); // start the overlay fade
        window.setTimeout(() => onDismissRef.current(), 380);
      };
      if (withRipple && point && !reducedMotion) {
        ripplesRef.current.push(spawnRipple(point.x, point.y, true));
        // Let the ripple expand for a beat before the overlay begins to fade,
        // so the dismissal reads as a deliberate ripple-out rather than a snap.
        window.setTimeout(fadeThenDismiss, 460);
      } else {
        setLeaving(true);
        window.setTimeout(() => onDismissRef.current(), 160);
      }
    },
    [reducedMotion],
  );

  // Mutable render state (kept in refs so the RAF loop reads live values without
  // re-subscribing).
  const ripplesRef = useRef<Ripple[]>([]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const fieldRef = useRef<Field | null>(null);
  const colorsRef = useRef<ScreensaverColors>(readColors());
  // Smoothed camera in normalized units (−1..1 per axis); eased toward the
  // cursor each frame so the sky pans like a turning head.
  const camRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Rotate the quote while the saver stays up.
  useEffect(() => {
    if (!config.showQuotes) return;
    const id = window.setInterval(
      () => setQuote(pickRandomQuote()),
      config.quoteRotateSeconds * 1000,
    );
    return () => window.clearInterval(id);
  }, [config.showQuotes, config.quoteRotateSeconds]);

  // Live clock (HH:MM + timezone), updated each minute.
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    const tick = () => setClock(fmt.format(new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Re-read theme colors if the theme changes while the saver is up.
  useEffect(() => {
    const off = bifrostEvents.on('theme.updated', () => {
      colorsRef.current = readColors();
    });
    return off;
  }, []);

  // Canvas setup, input, and the render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fieldRef.current = createField({
        width,
        height,
        density: config.density,
        motion: config.motion,
      });
    };
    resize();

    const draw = () => {
      const field = fieldRef.current;
      if (!field) return;
      const colors = colorsRef.current;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = colors.veil;
      ctx.fillRect(0, 0, width, height);

      // Camera: the smoothed cursor pans a world larger than the viewport, per
      // depth, so turning toward an edge reveals new stars/suns. Base offset
      // (−padX/−padY) recentres the oversized world in the viewport.
      const panPxX = easePan(camRef.current.x) * field.panX;
      const panPxY = easePan(camRef.current.y) * field.panY;
      const sx = (p: { x: number; depth: number }): number =>
        p.x - field.padX - panPxX * (DEPTH_PAN[p.depth] ?? 1);
      const sy = (p: { y: number; depth: number }): number =>
        p.y - field.padY - panPxY * (DEPTH_PAN[p.depth] ?? 1);

      // Connecting lines on the far layer only — also faded by focus so the
      // constellation thins out toward the rim.
      if (config.connectLines) {
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1;
        for (const link of nearPairs(field)) {
          const ax = sx(link.a);
          const ay = sy(link.a);
          const bx = sx(link.b);
          const by = sy(link.b);
          const f = reducedMotion
            ? 1
            : Math.min(focusFactor(ax, ay, width, height), focusFactor(bx, by, width, height));
          if (f <= 0.03) continue;
          ctx.globalAlpha = link.strength * 0.35 * (0.05 + 0.95 * f);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }

      // Particles, near layer drawn as glowing "suns". Each is faded + softened
      // by its screen-space focus (dense/sharp centre → sparse/hazy rim) and
      // gently pulses ("grows") over time for depth. Off-screen and past-the-rim
      // ones are culled; the real edge blur is the CSS backdrop-filter frame.
      const nowMs = performance.now();
      for (const p of field.particles) {
        const screenX = sx(p);
        const screenY = sy(p);
        if (screenX < -60 || screenX > width + 60 || screenY < -60 || screenY > height + 60) {
          continue;
        }
        const focus = reducedMotion ? 1 : focusFactor(screenX, screenY, width, height);
        if (focus <= 0.03) continue; // beyond the porthole rim
        const pulse = reducedMotion ? 1 : 1 + Math.sin(nowMs * p.twinkle + p.phase) * 0.28;
        const near = p.depth === LAYERS - 1;
        // Edges: dimmer (fewer) and a touch larger/softer; centre: crisp + full.
        const radius = p.size * pulse * (1 + (1 - focus) * 0.6);
        ctx.globalAlpha = p.alpha * pulse * (0.04 + 0.96 * focus);
        if (near) {
          ctx.shadowBlur = 10 + (1 - focus) * 6;
          ctx.shadowColor = colors.glow;
          ctx.fillStyle = colors.particle2;
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = colors.particle;
        }
        ctx.beginPath();
        ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Ripples.
      for (const r of ripplesRef.current) {
        ctx.globalAlpha = rippleAlpha(r);
        ctx.strokeStyle = colors.ripple;
        ctx.lineWidth = r.dismiss ? 2 : 1.5;
        const radius = rippleRadius(r);
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        // A fainter trailing ring for a bit of depth.
        ctx.globalAlpha = rippleAlpha(r) * 0.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius * 0.72, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const elapsed = now - last;
      if (elapsed < FRAME_MS) return;
      last = now - (elapsed % FRAME_MS);
      // Ease the camera toward the cursor (or recentre when reactivity is off).
      const pointer = pointerRef.current;
      const targetX = config.mouseReactive && pointer ? (pointer.x / width - 0.5) * 2 : 0;
      const targetY = config.mouseReactive && pointer ? (pointer.y / height - 0.5) * 2 : 0;
      camRef.current.x += (targetX - camRef.current.x) * CAMERA_EASE;
      camRef.current.y += (targetY - camRef.current.y) * CAMERA_EASE;
      if (fieldRef.current) step(fieldRef.current, elapsed);
      ripplesRef.current = advanceRipples(ripplesRef.current, elapsed);
      draw();
    };

    if (reducedMotion) {
      draw(); // one static frame, no animation
    } else {
      raf = requestAnimationFrame(loop);
    }

    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        if (reducedMotion) draw();
      }, RESIZE_DEBOUNCE_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      if (reducedMotion) draw();
    };
    const onPointerDown = (e: PointerEvent) => {
      beginDismiss(true, { x: e.clientX, y: e.clientY });
    };
    const onKeyDown = () => beginDismiss(false);

    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [config, reducedMotion, beginDismiss]);

  return (
    <div
      className={`nott${leaving ? ' nott--leaving' : ''}`}
      role="presentation"
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="nott__canvas" />
      {/* Real edge blur: a backdrop-filter frame masked to the rim, so the
          periphery goes out of focus like a helmet visor while the centre
          stays sharp. */}
      <div className="nott__depth" aria-hidden="true" />
      <div className="nott__brand">
        <span className="nott__mark">
          <MoonIcon size={18} />
          <span className="nott__name">Nótt</span>
        </span>
        <span className="nott__tag">
          night over the bridge{clock ? ` · ${clock}` : ''}
        </span>
      </div>
      {config.showQuotes && (
        <figure className="nott__quote" key={quote.text}>
          <blockquote>“{quote.text}”</blockquote>
          <figcaption>
            <span className="nott__author">— {quote.author}</span>
            <span className="nott__world">{WORLD_LABELS[quote.world]}</span>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
