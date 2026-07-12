import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { Input } from '../../core/ui/Field';
import { QrIcon } from '../../core/ui/icons';

/** Static design shell — real QR generation lands in PLAN-03. */

export function QrToolPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">runes · marks that carry meaning</span>
          <h2>QR tool</h2>
          <p>Get any device onto the bridge, or turn any text into a scannable code.</p>
        </div>
      </div>

      <div className="grid-2">
        <Card>
          <div className="stack">
            <h3>Join Bifrost</h3>
            <div className="qr-box" role="img" aria-label="QR code placeholder for the server address">
              <QrIcon size={72} />
            </div>
            <p className="caption">
              Scan from any phone on this Wi-Fi. Android tip: this encodes the LAN IP directly —
              no .local lookup needed.
            </p>
            <span className="mono caption">http://bifrost.local:4646 · http://192.168.1.33:4646</span>
          </div>
        </Card>

        <Card>
          <div className="stack">
            <h3>Make a QR</h3>
            <Input label="Text or URL" placeholder="https://…" />
            <div className="qr-box" role="img" aria-label="Generated QR code placeholder">
              <span className="caption">Your code appears here</span>
            </div>
            <div className="row">
              <Button>Generate</Button>
              <Button variant="ghost">Download PNG</Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
