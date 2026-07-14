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
 * contrast regardless of theme.
 */
export function QrCard({ text, size = 240, label, downloadName }: QrCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !text) return;
    QRCode.toCanvas(canvasRef.current, text, {
      width: size,
      margin: 2,
      color: { dark: '#0b0e14', light: '#ffffff' },
    })
      .then(() => setFailed(false))
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
