import { Button } from '../../../core/ui/Button';
import { Input } from '../../../core/ui/Field';
import { QrCard } from '../../../core/ui/QrCard';
import { useToolState } from '../useToolState';

const QR_SIZES = { small: 160, medium: 240, large: 320 } as const;
type QrSize = keyof typeof QR_SIZES;

/**
 * The QR generator, migrated off the standalone /sigil page (PLAN-18). Same
 * `core/ui/QrCard` doing the drawing — only the frame around it changed, so a
 * code produced here is byte-identical to one the old page produced.
 *
 * A QR is inherently a fixed-size square, so the output column pairs it with
 * what it encodes rather than centring it in a lake of empty space (the
 * "centred fixed-width block" the plan forbids).
 */
export function QrTool() {
  const [text, setText] = useToolState('qr.text', '');
  const [size, setSize] = useToolState<QrSize>('qr.size', 'medium');

  return (
    <>
      <div className="tool-controls">
        <Input
          label="Text or URL"
          placeholder="https://…"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="field">
          <span className="field__label">Size</span>
          <div className="tool-chiprow" role="group" aria-label="QR size">
            {(Object.keys(QR_SIZES) as QrSize[]).map((preset) => (
              <Button
                key={preset}
                variant={preset === size ? 'primary' : 'ghost'}
                size="sm"
                aria-pressed={preset === size}
                onClick={() => setSize(preset)}
              >
                {preset}
              </Button>
            ))}
          </div>
        </div>
        <p className="caption">Drawn in this browser — the text never leaves the device.</p>
      </div>

      <div className="tool-output tool-qr">
        <QrCard text={text} size={QR_SIZES[size]} downloadName="bifrost-qr.png" />
        <div className="tool-qr__detail">
          {text ? (
            <>
              <span className="field__label">Encodes</span>
              <p className="mono tool-qr__value">{text}</p>
              <p className="caption">
                {text.length} character{text.length === 1 ? '' : 's'} · error correction H, so the
                carved-out wordmark costs nothing
              </p>
            </>
          ) : (
            <p className="caption">
              Type anything on the left — a URL, a Wi-Fi password, a note — and the code appears
              here to scan or download.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
