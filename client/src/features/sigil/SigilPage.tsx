import { useState } from 'react';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { Input } from '../../core/ui/Field';
import { QrCard } from '../../core/ui/QrCard';

const QR_SIZES = { small: 160, medium: 240, large: 320 } as const;
type QrSize = keyof typeof QR_SIZES;

/**
 * Sigil = the QR generator, a stall in Diagon Alley (the utility toolbox).
 * "Join Bifrost" moved to Midgard during the nav reorg — getting a device onto
 * the bridge is a home action, not a utility.
 */
export function SigilPage() {
  const [text, setText] = useState('');
  const [size, setSize] = useState<QrSize>('medium');

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">sigils · marks that carry meaning</span>
          <h2>Make a QR</h2>
          <p>Turn any text or URL into a scannable code you can download.</p>
        </div>
      </div>

      <div className="grid-2">
        <Card>
          <div className="stack">
            <Input
              label="Text or URL"
              placeholder="https://…"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <QrCard text={text} size={QR_SIZES[size]} downloadName="bifrost-qr.png" />
            <div className="row" role="group" aria-label="QR size">
              {(Object.keys(QR_SIZES) as QrSize[]).map((preset) => (
                <Button
                  key={preset}
                  variant={preset === size ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setSize(preset)}
                >
                  {preset}
                </Button>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
