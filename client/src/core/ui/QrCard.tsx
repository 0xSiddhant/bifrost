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
  /** The wordmark gradient stops — same trio as the app's --bridge. */
  bridge: [string, string, string];
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
    bridge: [read('--accent', '#2dd4bf'), read('--accent-2', '#8b7cf6'), read('--ok', '#4ade80')],
  };
}

/**
 * Client-side QR rendering (nothing round-trips a server, works offline).
 * Reusable across features — qr-tool ships it, Heimdall consumes it in
 * PLAN-05.
 *
 * The library has no reserved-area API, so we take its raw module matrix
 * (QRCode.create) and paint the modules ourselves, skipping the band under
 * the center "Bifrost" wordmark — the label is carved out of the code, not
 * pasted over it. Error correction H reconstructs the skipped modules.
 * Modules stay dark-on-light in every theme; only the dark end is tinted.
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
    link.download = withContentSlug(downloadName, text);
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
 * "bifrost-qr.png" + "https://example.com/x" → "bifrost-qr-example-com-x.png":
 * a saved code should say what it encodes without being opened.
 */
function withContentSlug(baseName: string, content: string): string {
  const slug = content
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme adds noise, not identity
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  if (!slug) return baseName;
  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  return `${stem}-${slug}${ext}`;
}

const QUIET_ZONE_MODULES = 2;
/** Label band as a fraction of the code's width/height — ~7% of the area, far under H's 30%. */
const LABEL_WIDTH = 0.5;
const LABEL_HEIGHT = 0.15;

async function renderQr(canvas: HTMLCanvasElement, text: string, size: number): Promise<void> {
  const palette = readPalette();
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const moduleCount = qr.modules.size;
  const w = size * 2; // 2x for retina screens and downloaded PNGs
  canvas.width = w;
  canvas.height = w;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cell = w / (moduleCount + QUIET_ZONE_MODULES * 2);
  const origin = cell * QUIET_ZONE_MODULES;

  // Wordmark band, snapped outward to whole-module boundaries so no module
  // is half-covered — skipped entirely or kept entirely.
  const band = {
    left: Math.floor(((w * (1 - LABEL_WIDTH)) / 2 - origin) / cell),
    right: Math.ceil(((w * (1 + LABEL_WIDTH)) / 2 - origin) / cell) - 1,
    top: Math.floor(((w * (1 - LABEL_HEIGHT)) / 2 - origin) / cell),
    bottom: Math.ceil(((w * (1 + LABEL_HEIGHT)) / 2 - origin) / cell) - 1,
  };

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, w, w);

  const modules = new Path2D();
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.modules.get(row, col)) continue;
      const inBand = row >= band.top && row <= band.bottom && col >= band.left && col <= band.right;
      if (inBand) continue; // carved out for the wordmark
      modules.rect(origin + col * cell, origin + row * cell, cell, cell);
    }
  }
  const gradient = ctx.createLinearGradient(0, 0, w, w);
  gradient.addColorStop(0, palette.moduleA);
  gradient.addColorStop(1, palette.moduleB);
  ctx.fillStyle = gradient;
  ctx.fill(modules);

  await drawWordmark(ctx, w, palette);
}

/** The app wordmark — Space Grotesk bold with the bridge gradient — inside the carved band. */
async function drawWordmark(
  ctx: CanvasRenderingContext2D,
  w: number,
  palette: QrPalette,
): Promise<void> {
  const bandHeight = w * LABEL_HEIGHT;
  const maxWidth = w * LABEL_WIDTH * 0.92;
  let fontSize = bandHeight * 0.62;

  const fontFor = (px: number) => `700 ${px}px 'Space Grotesk', system-ui, sans-serif`;
  // Self-hosted font may not be in the font cache yet on first paint.
  await document.fonts.load(fontFor(fontSize)).catch(() => undefined);

  ctx.save();
  ctx.font = fontFor(fontSize);
  const width = ctx.measureText('Bifrost').width;
  if (width > maxWidth) {
    fontSize *= maxWidth / width;
    ctx.font = fontFor(fontSize);
  }

  const cx = w / 2;
  const cy = w / 2;
  const textWidth = ctx.measureText('Bifrost').width;
  const gradient = ctx.createLinearGradient(cx - textWidth / 2, cy, cx + textWidth / 2, cy);
  gradient.addColorStop(0, palette.bridge[0]);
  gradient.addColorStop(0.5, palette.bridge[1]);
  gradient.addColorStop(1, palette.bridge[2]);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = gradient;
  ctx.fillText('Bifrost', cx, cy);
  ctx.restore();
}
