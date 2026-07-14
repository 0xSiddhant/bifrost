import { useEffect, useState } from 'react';
import { apiGet } from '../../core/api';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { Input, Select } from '../../core/ui/Field';
import { QrCard } from '../../core/ui/QrCard';

const QR_SIZES = { small: 160, medium: 240, large: 320 } as const;
type QrSize = keyof typeof QR_SIZES;

export function QrToolPage() {
  const [serverUrls, setServerUrls] = useState<string[]>([]);
  const [joinUrl, setJoinUrl] = useState('');
  const [text, setText] = useState('');
  const [size, setSize] = useState<QrSize>('medium');

  useEffect(() => {
    let disposed = false;
    apiGet<{ urls: string[] }>('/api/qr/server-url')
      .then(({ urls }) => {
        if (disposed || urls.length === 0) return;
        setServerUrls(urls);
        // LAN IP first — Android can't resolve .local names.
        setJoinUrl(urls[0] ?? '');
      })
      .catch(() => {
        // Card falls back to the current address bar origin.
        if (!disposed) setJoinUrl(window.location.origin);
      });
    return () => {
      disposed = true;
    };
  }, []);

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
            <QrCard text={joinUrl} label="QR code for the server address" />
            {serverUrls.length > 1 && (
              <Select
                label="Address"
                value={joinUrl}
                onChange={(event) => setJoinUrl(event.target.value)}
              >
                {serverUrls.map((url) => (
                  <option key={url} value={url}>
                    {url}
                  </option>
                ))}
              </Select>
            )}
            <p className="caption">
              Scan from any phone on this Wi-Fi. Android tip: pick the IP address — no .local
              lookup needed.
            </p>
            {joinUrl && <span className="mono caption">{joinUrl}</span>}
          </div>
        </Card>

        <Card>
          <div className="stack">
            <h3>Make a QR</h3>
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
