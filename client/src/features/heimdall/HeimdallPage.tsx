import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiGet } from '../../core/api';
import { formatBytes, formatTimeAgo } from '../../core/format';
import { deviceLabel, deviceName } from '../../core/devices';
import { bifrostEvents } from '../../core/sse';
import { heimdallGate } from '../../core/heimdallGate';
import { eventToShortcut, prettyShortcut } from '../../core/shortcut';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { Input, Select } from '../../core/ui/Field';
import { QrCard } from '../../core/ui/QrCard';
import { FolderIcon, ShieldIcon } from '../../core/ui/icons';
import { ALL_COLLECTIONS, RELIC_COLLECTIONS, type RelicCollection } from '../../assets/relics';
import { getEnabledCollections, setEnabledCollections } from '../../core/relicPrefs';
import {
  fetchAudit,
  fetchManagedThemes,
  fetchPresence,
  fetchSettings,
  fetchStats,
  fetchUploads,
  login,
  logout,
  revokeSessions,
  setThemeEnabled,
  updateSettings,
  type AuditPage,
  type FolderUsage,
  type HeimdallSettings,
  type ManagedTheme,
  type PresenceDevice,
  type Stats,
  type UploadMeta,
} from './api';

type Phase = 'locked' | 'login' | 'dashboard';

/** Live client-side control (same class as the theme choice); server settings below are the real thing. */
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
          <input type="checkbox" checked={enabled.includes(name)} onChange={() => toggle(name)} />
          <span>{RELIC_COLLECTIONS[name].label}</span>
          <span className="badge">{RELIC_COLLECTIONS[name].relics.length} relics</span>
        </label>
      ))}
    </div>
  );
}

/** Enable/disable themes — enabled ones show in the top-right switcher (live via SSE). */
function ThemesManager() {
  const [themes, setThemes] = useState<ManagedTheme[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchManagedThemes()
      .then((res) => {
        if (!cancelled) setThemes(res.themes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (theme: ManagedTheme) => {
    setError(null);
    try {
      const updated = await setThemeEnabled(theme.id, !theme.enabled);
      setThemes((list) =>
        list.map((entry) => (entry.id === theme.id ? { ...entry, enabled: updated.enabled } : entry)),
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'At least one theme must stay enabled.'
          : 'Could not update that theme.',
      );
    }
  };

  return (
    <div className="stack">
      <p className="caption">
        Enabled themes appear in the top-right theme switcher. Disabling one hides it everywhere
        without deleting it.
      </p>
      <div className="stack" role="group" aria-label="Themes">
        {themes.map((theme) => (
          <label key={theme.id} className="check-row">
            <input type="checkbox" checked={theme.enabled} onChange={() => void toggle(theme)} />
            <span>{theme.name}</span>
            <span className="badge">{theme.mode}</span>
            {theme.builtIn && <span className="badge">built-in</span>}
          </label>
        ))}
      </div>
      {error && (
        <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Heimdall shows the character alias AND the original UA label together. */
function auditActor(row: { deviceId: string | null; ip: string | null }): string {
  const name = deviceName(row.deviceId);
  if (name) {
    const label = deviceLabel(row.deviceId);
    return label ? `${name} · ${label}` : name;
  }
  return row.ip ?? '—';
}

/** Live device roster for the admin — alias + original UA label + status. */
function ConnectedDevices() {
  const [devices, setDevices] = useState<PresenceDevice[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchPresence()
      .then((res) => {
        if (!cancelled) setDevices(res.devices);
      })
      .catch(() => {});
    const off = bifrostEvents.on('presence.changed', (payload) => {
      if (payload && typeof payload === 'object' && 'devices' in payload) {
        setDevices((payload as { devices: PresenceDevice[] }).devices);
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (devices.length === 0) return <p className="caption">No devices seen yet.</p>;
  return (
    <div className="stack">
      {devices.map((device) => (
        <div className="device-row" key={device.deviceId}>
          <span
            className={`device-dot ${device.online ? 'is-online' : 'is-offline'}`}
            aria-hidden="true"
          />
          <div className="device-row__body">
            <div className="device-row__name">
              {device.name ?? device.charName ?? device.label}
            </div>
            <div className="device-row__meta">
              <span>{device.label}</span>
              <span>
                {device.online ? 'online' : `last seen ${formatTimeAgo(device.lastSeen)}`}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The activity log (audit-log module), filterable by event type. */
function ActivityHistory() {
  const [page, setPage] = useState<AuditPage | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAudit({ event: filter || undefined })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <div className="stack">
      <Select
        label="Filter by event"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      >
        <option value="">All events</option>
        {(page?.events ?? []).map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </Select>
      {!page ? (
        <p className="caption">Loading…</p>
      ) : page.items.length === 0 ? (
        <p className="caption">No activity recorded yet.</p>
      ) : (
        page.items.map((row) => (
          <div className="file-row" key={row.id}>
            <div className="file-row__body">
              <div className="file-row__name mono">{row.event}</div>
              <div className="file-row__meta">
                {row.summary && <span>{row.summary}</span>}
                <span>{auditActor(row)}</span>
                <span>{formatTimeAgo(row.ts)}</span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}

/** Records a shortcut from an actual key combo, shown as key-caps — never raw tokens. */
function ShortcutField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      const next = eventToShortcut(event);
      if (next) {
        onChange(next);
        setRecording(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, onChange]);

  return (
    <div className="field">
      <span className="field__label">Admin shortcut</span>
      <div className="shortcut-field">
        <div className="kbd-combo" aria-label={`Current shortcut: ${value}`}>
          {recording ? (
            <span className="caption">Press a key combo…</span>
          ) : (
            prettyShortcut(value).map((chip, index) => (
              <kbd className="kbd" key={`${chip}-${index}`}>
                {chip}
              </kbd>
            ))
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setRecording((on) => !on)}>
          {recording ? 'Cancel' : 'Change'}
        </Button>
      </div>
    </div>
  );
}

// Categorical color per folder — fixed by identity, never by size (validated
// palette: CVD ΔE 35.5 aurora / 20.8 daybreak; gaps + legend values are the
// secondary encoding so identity is never carried by color alone).
const FOLDER_ORDER = ['uploads', 'downloads', 'logs', 'data'] as const;
const FOLDER_COLOR: Record<string, string> = {
  uploads: 'var(--accent)',
  downloads: 'var(--accent-2)',
  logs: 'var(--ok)',
  data: 'var(--warn)',
};

const DONUT_R = 42;
const DONUT_C = 2 * Math.PI * DONUT_R;
const DONUT_GAP = 2;

function DiskDonut({ disk, total }: { disk: FolderUsage[]; total: number }) {
  const byFolder = new Map(disk.map((entry) => [entry.folder, entry]));
  const ordered = FOLDER_ORDER.map((folder) => byFolder.get(folder)).filter(
    (entry): entry is FolderUsage => Boolean(entry),
  );

  let cursor = 0;
  const segments = ordered
    .filter((entry) => entry.bytes > 0)
    .map((entry) => {
      const length = (entry.bytes / total) * DONUT_C;
      const segment = {
        folder: entry.folder,
        dash: Math.max(length - DONUT_GAP, 0.5),
        offset: -cursor,
        color: FOLDER_COLOR[entry.folder] ?? 'var(--accent)',
      };
      cursor += length;
      return segment;
    });

  return (
    <div className="disk">
      <div className="donut">
        <svg viewBox="0 0 100 100" className="donut__svg" aria-hidden="true">
          <circle cx="50" cy="50" r={DONUT_R} className="donut__track" />
          {segments.map((segment) => (
            <circle
              key={segment.folder}
              cx="50"
              cy="50"
              r={DONUT_R}
              className="donut__seg"
              stroke={segment.color}
              strokeDasharray={`${segment.dash} ${DONUT_C - segment.dash}`}
              strokeDashoffset={segment.offset}
            >
              <title>{segment.folder}</title>
            </circle>
          ))}
        </svg>
        <div className="donut__center">
          <span className="donut__total">{formatBytes(total)}</span>
          <span className="caption">in use</span>
        </div>
      </div>
      <ul className="disk__legend">
        {ordered.map((entry) => {
          const pct = total > 0 ? Math.round((entry.bytes / total) * 100) : 0;
          return (
            <li className="legend-row" key={entry.folder}>
              <span
                className="legend-swatch"
                style={{ background: FOLDER_COLOR[entry.folder] ?? 'var(--accent)' }}
                aria-hidden="true"
              />
              <span className="legend-name mono">{entry.folder}</span>
              <span className="legend-val caption">
                {formatBytes(entry.bytes)} · {pct}% · {entry.files} files
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LoginView({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(pin);
      onUnlock();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts — wait a few minutes.');
      } else {
        setError('Incorrect PIN.');
      }
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="heimdall-gate">
      <Card>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <span className="empty__icon">
            <ShieldIcon size={28} />
          </span>
          <h2>Heimdall</h2>
          <p className="caption">The gatekeeper sees all. Identify yourself.</p>
          <Input
            label="PIN"
            type="password"
            inputMode="numeric"
            placeholder="••••"
            value={pin}
            autoFocus
            onChange={(event) => setPin(event.target.value)}
          />
          {error && (
            <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || pin.length === 0}>
            {busy ? 'Opening…' : 'Enter'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

interface ThemeOption {
  id: string;
  name: string;
}

function Dashboard({ onLock }: { onLock: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<HeimdallSettings | null>(null);
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([fetchStats(), fetchSettings(), fetchUploads()]).then(
      ([statsRes, settingsRes, uploadsRes]) => {
        if (cancelled) return;
        if (statsRes.status === 'fulfilled') setStats(statsRes.value);
        if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value);
        if (uploadsRes.status === 'fulfilled') setUploads(uploadsRes.value.items);
      },
    );
    apiGet<{ themes: ThemeOption[] }>('/api/themes')
      .then((res) => {
        if (!cancelled) setThemes(res.themes.map(({ id, name }) => ({ id, name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaved(null);
    setSaveError(null);
    try {
      const updated = await updateSettings({
        shortcut: settings.shortcut,
        tapCount: settings.tapCount,
        defaultThemeId: settings.defaultThemeId,
      });
      setSettings(updated);
      setSaved('Saved. Open clients rebind instantly.');
    } catch (err) {
      setSaveError(
        err instanceof ApiError && err.status === 400
          ? 'That shortcut is invalid or reserved by the browser.'
          : 'Could not save settings.',
      );
    }
  };

  const revoke = async () => {
    await revokeSessions().catch(() => {});
    onLock();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">the watchtower · himinbjörg</span>
          <h2>Heimdall</h2>
          <p>Watchtower over the bridge — activity, devices, and the runtime dials.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onLock}>
          Lock
        </Button>
      </div>

      <div className="stack">
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value">{stats?.connectedClients ?? '—'}</div>
            <div className="stat__label">devices connected</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats?.uploads.today ?? '—'}</div>
            <div className="stat__label">uploads today</div>
          </div>
          <div className="stat">
            <div className="stat__value mono">
              {stats ? formatUptime(stats.uptimeSeconds) : '—'}
            </div>
            <div className="stat__label">uptime</div>
          </div>
        </div>

        <h3>Disk usage</h3>
        <Card>
          {stats ? (
            <DiskDonut disk={stats.disk} total={stats.totalBytes} />
          ) : (
            <p className="caption">Measuring storage…</p>
          )}
        </Card>

        <h3>Recent uploads</h3>
        <Card>
          {uploads.length === 0 ? (
            <p className="caption">No uploads recorded yet.</p>
          ) : (
            uploads.slice(0, 12).map((upload) => (
              <div className="file-row" key={upload.name + upload.uploadedAt}>
                <div className="file-row__body">
                  <div className="file-row__name">{upload.name}</div>
                  <div className="file-row__meta">
                    <span>{formatBytes(upload.size)}</span>
                    <span>{upload.uploaderHint ?? 'unknown device'}</span>
                    <span>{formatTimeAgo(upload.uploadedAt)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>

        <h3>Settings</h3>
        <Card>
          {settings ? (
            <div className="stack">
              <ShortcutField
                value={settings.shortcut}
                onChange={(shortcut) => setSettings({ ...settings, shortcut })}
              />
              <Select
                label="Hidden tap count"
                value={String(settings.tapCount)}
                onChange={(event) =>
                  setSettings({ ...settings, tapCount: Number(event.target.value) })
                }
              >
                {[5, 7, 9, 11].map((count) => (
                  <option key={count} value={count}>
                    {count} taps
                  </option>
                ))}
              </Select>
              <Select
                label="Default theme"
                value={settings.defaultThemeId ?? ''}
                onChange={(event) =>
                  setSettings({ ...settings, defaultThemeId: event.target.value || null })
                }
              >
                <option value="">Follow each device (OS scheme)</option>
                {themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
              </Select>
              {saved && (
                <p className="caption" role="status" style={{ color: 'var(--ok)' }}>
                  {saved}
                </p>
              )}
              {saveError && (
                <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
                  {saveError}
                </p>
              )}
              <div className="row">
                <Button onClick={() => void save()}>Save</Button>
                <Button variant="danger" onClick={() => void revoke()}>
                  Revoke all sessions
                </Button>
              </div>
            </div>
          ) : (
            <p className="caption">Loading settings…</p>
          )}
        </Card>

        <h3>Connected devices</h3>
        <Card>
          <ConnectedDevices />
        </Card>

        <h3>Activity history</h3>
        <Card>
          <ActivityHistory />
        </Card>

        <h3>Themes</h3>
        <Card>
          <ThemesManager />
        </Card>

        <h3>Join the bridge</h3>
        <Card>
          <div className="stack">
            <p className="caption">Point a device's camera here to open Bifrost on this network.</p>
            <QrCard text={window.location.origin} label="Join Bifrost" />
          </div>
        </Card>

        <h3>Sky relics</h3>
        <Card>
          <div className="stack">
            <p className="caption">
              The artifacts drifting in the background. Applies on this device immediately; uncheck
              everything for a clear sky. Default: all collections.
            </p>
            <RelicSettings />
          </div>
        </Card>
      </div>
    </>
  );
}

export function HeimdallPage() {
  const navigate = useNavigate();
  // A lingering session cookie is never trusted for the UI: the dashboard shows
  // only after a fresh PIN entry in THIS mount. So a direct URL, a new tab, the
  // back button, or a refresh (all start with no gesture and no in-mount login)
  // land on the 404-lookalike until the entry gesture, then the PIN screen.
  const [phase, setPhase] = useState<Phase>(() =>
    heimdallGate.revealed ? 'login' : 'locked',
  );

  // Leaving Heimdall (nav away, back, lock) ends the admin session and re-hides
  // the door, so every return requires the gesture + PIN again — even in a tab
  // that still holds a cookie.
  useEffect(() => {
    return () => {
      void logout().catch(() => {});
      heimdallGate.reset();
    };
  }, []);

  // Direct URL with no gesture and no session: indistinguishable from a 404
  // (mirrors NotFoundPage exactly — the route must not be discoverable).
  if (phase === 'locked') {
    return (
      <EmptyState
        icon={<FolderIcon size={28} />}
        title="404 — off the bridge"
        hint="This realm doesn't exist. Heimdall has no record of it."
        action={
          <Button variant="ghost" onClick={() => navigate('/')}>
            Back to Midgard
          </Button>
        }
      />
    );
  }
  if (phase === 'login') {
    return <LoginView onUnlock={() => setPhase('dashboard')} />;
  }
  // Leaving the page unmounts this component → the cleanup above logs out.
  return <Dashboard onLock={() => navigate('/')} />;
}
