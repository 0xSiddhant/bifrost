import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { Select } from './Field';
import { QrCard } from './QrCard';

/**
 * The "get another device onto the bridge" card: a QR of the server's LAN
 * address. Lives on Midgard (home) — joining the bridge is a connect-a-device
 * action, not a utility. Laid out horizontally (code beside the details) so it
 * reads as one wide onboarding band under the transfer doors, rather than a
 * tall card fighting a short one for equal height.
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
    <section className="join-card">
      <div className="join-card__qr">
        <QrCard text={joinUrl} size={196} label="QR code for the server address" />
      </div>
      <div className="join-card__body">
        <span className="eyebrow eyebrow--violet">onboard a device</span>
        <h3 className="join-card__title">Join Bifrost</h3>
        <p className="caption">
          Scan from any phone on this Wi-Fi to open the bridge here. Android tip: pick the IP
          address — no .local lookup needed.
        </p>
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
        {joinUrl && <span className="mono caption join-card__url">{joinUrl}</span>}
      </div>
    </section>
  );
}
