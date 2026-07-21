import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiGet } from '../../core/api';
import { formatBytes, formatTimeAgo } from '../../core/format';
import { deviceLabel, deviceName } from '../../core/devices';
import { bifrostEvents } from '../../core/sse';
import { eventToShortcut, prettyShortcut } from '../../core/shortcut';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { Select } from '../../core/ui/Field';
import { QrCard } from '../../core/ui/QrCard';
import {
  ClipboardIcon,
  FolderIcon,
  MonitorIcon,
  QrIcon,
  ShieldIcon,
  UploadIcon,
} from '../../core/ui/icons';
import { ALL_COLLECTIONS, RELIC_COLLECTIONS, type RelicCollection } from '../../assets/relics';
import { getEnabledCollections, setEnabledCollections } from '../../core/relicPrefs';
import {
  fetchAudit,
  fetchManagedThemes,
  fetchPresence,
  fetchSettings,
  fetchStats,
  fetchUploads,
  prunePresence,
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

/**
 * A section of the Heimdall modal. `group` places it in the left-panel nav;
 * `manifest` lists the individual controls the search box can jump to (each
 * control renders with `id={ctlId(controlId)}` so the modal can scroll-highlight
 * it). Section components are self-contained: they fetch their own data on mount
 * so only the visible section pays for it.
 */
export interface SectionManifestItem {
  controlId: string;
  label: string;
  keywords?: string[];
}

export interface SectionProps {
  onLock: () => void;
}

export interface HeimdallSection {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  blurb: string;
  Component: (props: SectionProps) => ReactNode;
  manifest: SectionManifestItem[];
}

/** DOM id for a searchable control, so search can scroll+highlight it. */
export const ctlId = (controlId: string): string => `heimdall-ctl-${controlId}`;

/** Ordered groups for the left panel (per PLAN-10). */
export const SECTION_GROUPS = ['Watchtower', 'Realm', 'Vault', 'Bridge'] as const;

// ── shared bits ─────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
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

// ── Overview ────────────────────────────────────────────────────

function OverviewSection() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [devices, setDevices] = useState<PresenceDevice[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStats()
      .then((res) => {
        if (!cancelled) setStats(res);
      })
      .catch(() => {});
    // Device counts come from the presence roster — the same source Wardens
    // uses — so "connected" and "known" always agree with that list.
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

  const connected = devices ? devices.filter((device) => device.online).length : null;
  const known = devices ? devices.length : null;

  return (
    <div className="stat-grid" id={ctlId('overview-stats')}>
      <div className="stat">
        <div className="stat__value">{connected ?? '—'}</div>
        <div className="stat__label">devices connected</div>
      </div>
      <div className="stat">
        <div className="stat__value">{known ?? '—'}</div>
        <div className="stat__label">devices known</div>
      </div>
      <div className="stat">
        <div className="stat__value">{stats?.uploads.today ?? '—'}</div>
        <div className="stat__label">uploads today</div>
      </div>
      <div className="stat">
        <div className="stat__value">{stats?.uploads.total ?? '—'}</div>
        <div className="stat__label">uploads total</div>
      </div>
      <div className="stat">
        <div className="stat__value mono">{stats ? formatUptime(stats.uptimeSeconds) : '—'}</div>
        <div className="stat__label">uptime</div>
      </div>
    </div>
  );
}

// ── Activity ────────────────────────────────────────────────────

function ActivitySection() {
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
      <div id={ctlId('activity-filter')}>
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
      </div>
      <Card>
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
      </Card>
    </div>
  );
}

// ── Wardens (device roster; admin actions land in a later tranche) ──

function WardensSection() {
  const [devices, setDevices] = useState<PresenceDevice[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Opening this surface prunes devices unseen for > 7 days and shows the
    // fresh roster (their activity elsewhere is preserved server-side). The
    // prune is best-effort: if it's unavailable, fall back to the plain list so
    // the roster never blanks out.
    prunePresence()
      .then((res) => {
        if (!cancelled) setDevices(res.devices);
      })
      .catch(() =>
        fetchPresence()
          .then((res) => {
            if (!cancelled) setDevices(res.devices);
          })
          .catch(() => {}),
      );
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

  return (
    <Card>
      <div className="stack" id={ctlId('devices-list')}>
        {devices.length === 0 ? (
          <p className="caption">No devices seen yet.</p>
        ) : (
          devices.map((device) => (
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
          ))
        )}
      </div>
    </Card>
  );
}

// ── Settings ────────────────────────────────────────────────────

/** Records a shortcut from an actual key combo, shown as key-caps. */
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
    <div className="field" id={ctlId('shortcut')}>
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

interface ThemeOption {
  id: string;
  name: string;
}

function SettingsSection({ onLock }: SectionProps) {
  const [settings, setSettings] = useState<HeimdallSettings | null>(null);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((res) => {
        if (!cancelled) setSettings(res);
      })
      .catch(() => {});
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

  if (!settings) return <p className="caption">Loading settings…</p>;
  return (
    <Card>
      <div className="stack">
        <ShortcutField
          value={settings.shortcut}
          onChange={(shortcut) => setSettings({ ...settings, shortcut })}
        />
        <div id={ctlId('tap-count')}>
          <Select
            label="Hidden tap count"
            value={String(settings.tapCount)}
            onChange={(event) => setSettings({ ...settings, tapCount: Number(event.target.value) })}
          >
            {[5, 7, 9, 11].map((count) => (
              <option key={count} value={count}>
                {count} taps
              </option>
            ))}
          </Select>
        </div>
        <div id={ctlId('default-theme')}>
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
        </div>
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
        <div className="row" id={ctlId('revoke')}>
          <Button onClick={() => void save()}>Save</Button>
          <Button variant="danger" onClick={() => void revoke()}>
            Revoke all sessions
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Themes ──────────────────────────────────────────────────────

function ThemesSection() {
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
    <Card>
      <div className="stack">
        <p className="caption">
          Enabled themes appear in the top-right theme switcher. Disabling one hides it everywhere
          without deleting it.
        </p>
        <div className="stack" role="group" aria-label="Themes" id={ctlId('themes-list')}>
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
    </Card>
  );
}

// ── Sky Relics ──────────────────────────────────────────────────

function RelicsSection() {
  const [enabled, setEnabled] = useState<RelicCollection[]>(getEnabledCollections);

  const toggle = (name: RelicCollection) => {
    const next = enabled.includes(name)
      ? enabled.filter((entry) => entry !== name)
      : [...ALL_COLLECTIONS.filter((entry) => entry === name || enabled.includes(entry))];
    setEnabled(next);
    setEnabledCollections(next);
  };

  return (
    <Card>
      <div className="stack">
        <p className="caption">
          The artifacts drifting in the background. Applies on this device immediately; uncheck
          everything for a clear sky. Default: all collections.
        </p>
        <div className="stack" role="group" aria-label="Relic collections" id={ctlId('relics')}>
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
      </div>
    </Card>
  );
}

// ── Storage (donut; expanded in a later tranche) ────────────────

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

function StorageSection() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchStats()
      .then((res) => {
        if (!cancelled) setStats(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <div id={ctlId('disk-usage')}>
        {stats ? (
          <DiskDonut disk={stats.disk} total={stats.totalBytes} />
        ) : (
          <p className="caption">Measuring storage…</p>
        )}
      </div>
    </Card>
  );
}

// ── Uploads ─────────────────────────────────────────────────────

function UploadsSection() {
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchUploads()
      .then((res) => {
        if (!cancelled) setUploads(res.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <div id={ctlId('uploads-list')}>
        {uploads.length === 0 ? (
          <p className="caption">No uploads recorded yet.</p>
        ) : (
          uploads.slice(0, 30).map((upload) => (
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
      </div>
    </Card>
  );
}

// ── Network ─────────────────────────────────────────────────────

function NetworkSection() {
  return (
    <Card>
      <div className="stack" id={ctlId('join-qr')}>
        <p className="caption">Point a device's camera here to open Bifrost on this network.</p>
        <QrCard text={window.location.origin} label="Join Bifrost" />
      </div>
    </Card>
  );
}

// ── Registry ────────────────────────────────────────────────────

export const SECTIONS: HeimdallSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    group: 'Watchtower',
    icon: <ShieldIcon size={16} />,
    blurb: 'Activity, devices, and the runtime dials at a glance.',
    Component: OverviewSection,
    manifest: [],
  },
  {
    id: 'activity',
    label: 'Activity',
    group: 'Watchtower',
    icon: <ShieldIcon size={16} />,
    blurb: 'The cross-module history log.',
    Component: ActivitySection,
    manifest: [{ controlId: 'activity-filter', label: 'Filter by event', keywords: ['audit', 'log', 'history'] }],
  },
  {
    id: 'wardens',
    label: 'Wardens',
    group: 'Watchtower',
    icon: <MonitorIcon size={16} />,
    blurb: 'Every warden seen on the bridge — alias and original label.',
    Component: WardensSection,
    manifest: [
      { controlId: 'devices-list', label: 'Connected devices', keywords: ['presence', 'wardens', 'devices'] },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    group: 'Realm',
    icon: <ShieldIcon size={16} />,
    blurb: 'Entry gesture, default theme, and session control.',
    Component: SettingsSection,
    manifest: [
      { controlId: 'shortcut', label: 'Admin shortcut', keywords: ['keyboard', 'hotkey', 'key'] },
      { controlId: 'tap-count', label: 'Hidden tap count', keywords: ['tap', 'taps', 'gesture', 'count'] },
      { controlId: 'default-theme', label: 'Default theme', keywords: ['theme'] },
      { controlId: 'revoke', label: 'Revoke all sessions', keywords: ['logout', 'sessions', 'lock'] },
    ],
  },
  {
    id: 'themes',
    label: 'Themes',
    group: 'Realm',
    icon: <QrIcon size={16} />,
    blurb: 'Enable or disable themes in the switcher.',
    Component: ThemesSection,
    manifest: [{ controlId: 'themes-list', label: 'Enable / disable themes', keywords: ['theme', 'switcher'] }],
  },
  {
    id: 'relics',
    label: 'Sky Relics',
    group: 'Realm',
    icon: <FolderIcon size={16} />,
    blurb: 'The artifacts drifting in the background sky.',
    Component: RelicsSection,
    manifest: [{ controlId: 'relics', label: 'Relic collections', keywords: ['background', 'artifacts', 'sky'] }],
  },
  {
    id: 'storage',
    label: 'Storage',
    group: 'Vault',
    icon: <FolderIcon size={16} />,
    blurb: 'Disk usage across the storage folders.',
    Component: StorageSection,
    manifest: [{ controlId: 'disk-usage', label: 'Disk usage', keywords: ['disk', 'space', 'bytes'] }],
  },
  {
    id: 'uploads',
    label: 'Uploads',
    group: 'Vault',
    icon: <UploadIcon size={16} />,
    blurb: 'Metadata for everything that has been sent.',
    Component: UploadsSection,
    manifest: [{ controlId: 'uploads-list', label: 'Recent uploads', keywords: ['files', 'sent'] }],
  },
  {
    id: 'network',
    label: 'Network',
    group: 'Bridge',
    icon: <ClipboardIcon size={16} />,
    blurb: 'Join QR and the addresses this server answers on.',
    Component: NetworkSection,
    manifest: [{ controlId: 'join-qr', label: 'Join QR', keywords: ['qr', 'lan', 'address', 'connect'] }],
  },
];
