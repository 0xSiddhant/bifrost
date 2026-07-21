import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { Card } from './Card';
import { Select } from './Field';
import { QrCard } from './QrCard';

/**
 * The "get another device onto the bridge" card: a QR of the server's LAN
 * address. Lives on Midgard (home) — joining the bridge is a connect-a-device
 * action, not a utility. Extracted from the old Sigil page during the nav
 * reorg so the QR generator could move to Diagon Alley on its own.
 */
export function JoinBifrostCard() {
  const [serverUrls, setServerUrls] = useState<string[]>([]);
  const [joinUrl, setJoinUrl] = useState('');

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
          Scan from any phone on this Wi-Fi. Android tip: pick the IP address — no .local lookup
          needed.
        </p>
        {joinUrl && <span className="mono caption">{joinUrl}</span>}
      </div>
    </Card>
  );
}
