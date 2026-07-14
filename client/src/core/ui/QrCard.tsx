import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from './Button';

interface QrCardProps {
  text: string;
  /** Rendered pixel width. */
  size?: number;
  label?: string;
  /** When set, a "Download PNG" button saves the code under this filename. */
  downloadName?: string;
}

interface QrPalette {
  moduleA: string;
  moduleB: string;
  bg: string;
  arcs: [string, string, string];
}

/** Canvas can't read CSS vars — resolve the current theme's QR tokens at draw time. */
function readPalette(): QrPalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    moduleA: read('--qr-module-a', '#0f766e'),
    moduleB: read('--qr-module-b', '#6d28d9'),
    bg: read('--qr-bg', '#ffffff'),
    arcs: [read('--accent', '#2dd4bf'), read('--accent-2', '#8b7cf6'), read('--ok', '#4ade80')],
  };
}

/**
 * Client-side QR rendering (nothing round-trips a server, works offline).
 * Reusable across features — qr-tool ships it, Heimdall consumes it in
 * PLAN-05. Modules render as a theme-tinted gradient (dark-on-light always —
 * scanners need the contrast) with a bridge badge in the center; error
 * correction runs at H (30%) so the covered modules stay recoverable.
 */
export function QrCard({ text, size = 240, label, downloadName }: QrCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [themeTick, setThemeTick] = useState(0);

  // Redraw when the theme flips — the palette lives on <html data-theme>.
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((tick) => tick + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !text) return;
    renderQr(canvas, text, size)
      .then(() => setFailed(false))
      .catch(() => setFailed(true));
  }, [text, size, themeTick]);

  if (!text) {
    return (
      <div className="qr-box">
        <span className="caption">Your code appears here</span>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="qr-box">
        <span className="caption">Too much text for one QR code — trim it down.</span>
      </div>
    );
  }

  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas || !downloadName) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = downloadName;
    link.click();
  };

  return (
    <div className="qr-card">
      <div className="qr-frame">
        <canvas
          ref={canvasRef}
          className="qr-canvas"
          style={{ width: size, height: size }}
          role="img"
          aria-label={label ?? `QR code for ${text}`}
        />
      </div>
      {downloadName && (
        <Button variant="ghost" size="sm" onClick={downloadPng}>
          Download PNG
        </Button>
      )}
    </div>
  );
}

/**
 * Draw pipeline: qrcode paints pure-black modules on transparency, then
 * compositing swaps black for the theme gradient (`source-in`) and slides the
 * light background underneath (`destination-over`). 2x render keeps retina
 * screens and downloaded PNGs crisp.
 */
async function renderQr(canvas: HTMLCanvasElement, text: string, size: number): Promise<void> {
  const palette = readPalette();
  await QRCode.toCanvas(canvas, text, {
    width: size * 2,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000ff', light: '#00000000' },
  });
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;

  ctx.save();
  ctx.globalCompositeOperation = 'source-in';
  const gradient = ctx.createLinearGradient(0, 0, w, w);
  gradient.addColorStop(0, palette.moduleA);
  gradient.addColorStop(1, palette.moduleB);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, w);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, w, w);
  ctx.restore();

  drawBridgeBadge(ctx, w, palette);
}

/**
 * Center badge: a compact disc with the rainbow bridge rising from its lower
 * third and a hairline gradient ring. Drawn, not an image asset — crisp at
 * any size. ~23% of the code's width, well inside level-H tolerance.
 */
function drawBridgeBadge(ctx: CanvasRenderingContext2D, w: number, palette: QrPalette): void {
  const cx = w / 2;
  const cy = w / 2;
  const radius = w * 0.115;

  ctx.save();

  // Disc with a soft drop shadow so it floats over the modules.
  ctx.shadowColor = 'rgba(10, 14, 24, 0.28)';
  ctx.shadowBlur = radius * 0.35;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Hairline ring in the module gradient ties the badge to the code.
  const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  ring.addColorStop(0, palette.moduleA);
  ring.addColorStop(1, palette.moduleB);
  ctx.lineWidth = radius * 0.07;
  ctx.strokeStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();

  // The bridge: three arcs sharing a baseline just below center, sized to
  // fill the disc instead of floating in white space.
  const baseline = cy + radius * 0.34;
  const arcRadii = [0.62, 0.42, 0.22].map((factor) => radius * factor);
  ctx.lineWidth = radius * 0.16;
  ctx.lineCap = 'round';
  arcRadii.forEach((arcRadius, index) => {
    ctx.beginPath();
    ctx.arc(cx, baseline, arcRadius, Math.PI, Math.PI * 2);
    ctx.strokeStyle = palette.arcs[index] ?? palette.arcs[0];
    ctx.stroke();
  });

  ctx.restore();
}
