import { useState } from 'react';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { Input, Select } from '../../core/ui/Field';
import { ShieldIcon } from '../../core/ui/icons';
import { ALL_COLLECTIONS, RELIC_COLLECTIONS, type RelicCollection } from '../../assets/relics';
import { getEnabledCollections, setEnabledCollections } from '../../core/relicPrefs';

/** Static design shells for both Heimdall views — real auth lands in PLAN-05. */

/** Live client-side control (same class as the theme choice); server-backed settings land in PLAN-05. */
function RelicSettings() {
  const [enabled, setEnabled] = useState<RelicCollection[]>(getEnabledCollections);

  const toggle = (name: RelicCollection) => {
    const next = enabled.includes(name)
      ? enabled.filter((entry) => entry !== name)
      : [...ALL_COLLECTIONS.filter((entry) => entry === name || enabled.includes(entry))];
    setEnabled(next);
    setEnabledCollections(next);
  };

  return (
    <div className="stack" role="group" aria-label="Relic collections">
      {ALL_COLLECTIONS.map((name) => (
        <label key={name} className="check-row">
          <input
            type="checkbox"
            checked={enabled.includes(name)}
            onChange={() => toggle(name)}
          />
          <span>{RELIC_COLLECTIONS[name].label}</span>
          <span className="badge">{RELIC_COLLECTIONS[name].relics.length} relics</span>
        </label>
      ))}
    </div>
  );
}

const MOCK_AUDIT = [
  { event: 'file.uploaded', detail: 'vacation-photos_2026.zip · 184.2 MB', device: 'iPhone', time: '2m ago' },
  { event: 'download.added', detail: 'family-album-june.zip', device: 'host', time: '9m ago' },
  { event: 'clipboard.updated', detail: '58 chars', device: 'Pixel', time: '1h ago' },
];

export function HeimdallPage() {
  // Design-review helper only: shows the post-login dashboard. Real session in PLAN-05.
  const [unlocked, setUnlocked] = useState(false);

  if (!unlocked) {
    return (
      <div className="heimdall-gate">
        <Card>
          <div className="stack">
            <span className="empty__icon">
              <ShieldIcon size={28} />
            </span>
            <h2>Heimdall</h2>
            <p className="caption">The gatekeeper sees all. Identify yourself.</p>
            <Input label="PIN" type="password" inputMode="numeric" placeholder="••••" />
            <Button onClick={() => setUnlocked(true)}>Enter</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">the watchtower · himinbjörg</span>
          <h2>Heimdall</h2>
          <p>Watchtower over the bridge — activity, devices, and the runtime dials.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setUnlocked(false)}>
          Lock
        </Button>
      </div>

      <div className="stack">
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value">3</div>
            <div className="stat__label">devices connected</div>
          </div>
          <div className="stat">
            <div className="stat__value">27</div>
            <div className="stat__label">uploads today</div>
          </div>
          <div className="stat">
            <div className="stat__value mono">14h 22m</div>
            <div className="stat__label">uptime</div>
          </div>
        </div>

        <h3>Recent activity</h3>
        <Card>
          {MOCK_AUDIT.map((entry) => (
            <div className="file-row" key={entry.time + entry.event}>
              <div className="file-row__body">
                <div className="file-row__name">{entry.event}</div>
                <div className="file-row__meta">
                  <span>{entry.detail}</span>
                  <span>{entry.device}</span>
                  <span>{entry.time}</span>
                </div>
              </div>
            </div>
          ))}
        </Card>

        <h3>Settings</h3>
        <Card>
          <div className="stack">
            <Input label="Admin shortcut" defaultValue="shift+meta+comma" />
            <Select label="Hidden tap count" defaultValue="7">
              <option value="5">5 taps</option>
              <option value="7">7 taps</option>
              <option value="9">9 taps</option>
            </Select>
            <div className="row">
              <Button>Save</Button>
              <Button variant="danger">Revoke all sessions</Button>
            </div>
          </div>
        </Card>

        <h3>Sky relics</h3>
        <Card>
          <div className="stack">
            <p className="caption">
              The artifacts drifting in the background. Applies on this device immediately;
              uncheck everything for a clear sky. Default: all collections.
            </p>
            <RelicSettings />
          </div>
        </Card>
      </div>
    </>
  );
}
