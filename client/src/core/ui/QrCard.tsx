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

/**
 * Client-side QR rendering (nothing round-trips a server, works offline).
 * Reusable across features — qr-tool ships it, Heimdall consumes it in
 * PLAN-05. Colors are intentionally fixed black-on-white: scanners need the
 * contrast regardless of theme. A bifrost bridge badge sits in the center;
 * error correction runs at H (30%) so the covered modules stay recoverable.
 */
export function QrCard({ text, size = 240, label, downloadName }: QrCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !text) return;
    // Render at 2x and let CSS scale down — crisp on retina screens and in
    // the downloaded PNG alike.
    QRCode.toCanvas(canvas, text, {
      width: size * 2,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#0b0e14', light: '#ffffff' },
    })
      .then(() => {
        drawBridgeBadge(canvas);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [text, size]);

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
      <canvas
        ref={canvasRef}
        className="qr-canvas"
        style={{ width: size, height: size }}
        role="img"
        aria-label={label ?? `QR code for ${text}`}
      />
      {downloadName && (
        <Button variant="ghost" size="sm" onClick={downloadPng}>
          Download PNG
        </Button>
      )}
    </div>
  );
}

/** The brand's --bridge gradient stops (tokens.css). */
const BRIDGE_COLORS = ['#2dd4bf', '#8b7cf6', '#4ade80'] as const;

/**
 * Center badge: white rounded tile with three rainbow-bridge arcs. Drawn, not
 * an image asset — there is none, and canvas keeps it sharp at every size.
 * The tile covers ~22% of the code's width, well inside level-H tolerance.
 */
function drawBridgeBadge(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const badge = w * 0.22;
  const left = (w - badge) / 2;
  const top = (w - badge) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(left, top, badge, badge, badge * 0.22);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = Math.max(1, w * 0.004);
  ctx.strokeStyle = '#e2e5ea';
  ctx.stroke();

  // Three concentric arcs rising from a shared baseline — the bridge.
  const cx = w / 2;
  const baseline = top + badge * 0.74;
  const radii = [0.3, 0.21, 0.12].map((factor) => badge * factor);
  ctx.lineWidth = badge * 0.065;
  ctx.lineCap = 'round';
  radii.forEach((radius, index) => {
    ctx.beginPath();
    ctx.arc(cx, baseline, radius, Math.PI, 2 * Math.PI);
    ctx.strokeStyle = BRIDGE_COLORS[index] ?? BRIDGE_COLORS[0];
    ctx.stroke();
  });
  ctx.restore();
}
