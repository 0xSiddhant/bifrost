import { useEffect, useState } from 'react';
import { getDeviceId } from '../../core/deviceId';
import { formatTimeAgo } from '../../core/format';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { MonitorIcon } from '../../core/ui/icons';
import { renameDevice, type PresenceDevice } from './api';
import { usePresence } from './usePresence';

function DeviceRow({
  device,
  isSelf,
  onRename,
}: {
  device: PresenceDevice;
  isSelf: boolean;
  onRename: (deviceId: string, name: string) => void;
}) {
  const [draft, setDraft] = useState(device.name ?? '');
  useEffect(() => {
    setDraft(device.name ?? '');
  }, [device.name]);

  return (
    <div className="device-row">
      <span
        className={`device-dot ${device.online ? 'is-online' : 'is-offline'}`}
        aria-hidden="true"
      />
      <div className="device-row__body">
        <div className="device-row__name">
          {device.name ?? device.charName ?? device.label}
          {isSelf && <span className="badge">this device</span>}
        </div>
        <div className="device-row__meta">
          <span>{device.online ? 'online' : `last seen ${formatTimeAgo(device.lastSeen)}`}</span>
        </div>
      </div>
      {isSelf && (
        <form
          className="device-row__rename"
          onSubmit={(event) => {
            event.preventDefault();
            onRename(device.deviceId, draft);
          }}
        >
          <input
            className="field__input"
            value={draft}
            placeholder="Name this device"
            maxLength={40}
            aria-label="Device name"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="ghost">
            Save
          </Button>
        </form>
      )}
    </div>
  );
}

export function WardensPage() {
  const { devices, ready } = usePresence();
  const myId = getDeviceId();
  const [error, setError] = useState<string | null>(null);

  const rename = async (deviceId: string, name: string) => {
    setError(null);
    try {
      await renameDevice(deviceId, name.trim() || null);
    } catch {
      setError('Could not rename that device.');
    }
  };

  const online = devices.filter((d) => d.online).length;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">the bridge-wardens · who is crossing</span>
          <h2>Wardens</h2>
          <p>
            Everyone on the bridge right now{devices.length > 0 && `, ${online} online`}. Name your
            device so others recognize it.
          </p>
        </div>
      </div>

      <div className="stack">
        {error && (
          <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        {ready && devices.length === 0 ? (
          <EmptyState
            icon={<MonitorIcon size={28} />}
            title="No devices yet"
            hint="Open Bifrost on another device and it appears here."
          />
        ) : (
          <Card>
            {devices.map((device) => (
              <DeviceRow
                key={device.deviceId}
                device={device}
                isSelf={device.deviceId === myId}
                onRename={rename}
              />
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
