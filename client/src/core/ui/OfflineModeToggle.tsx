import type { WarmLoadStatus } from '../offlineMode';
import { WifiOffIcon } from './icons';

/**
 * Offline mode's header control (PLAN-22): a switch that arms the warm load,
 * and a pill saying how it went. Purely presentational — the status and the
 * click handler come from the app shell, which owns both the config and the
 * warmed modules (they belong to the tab, not to a page).
 *
 * The switch always starts Off: warming only ever happens from a real click,
 * never re-armed from a remembered preference.
 */
export interface OfflineModeToggleProps {
  status: WarmLoadStatus;
  /** Disabled until the policy config has arrived. */
  ready: boolean;
  onChange: (on: boolean) => void;
}

function pillText(status: WarmLoadStatus): string {
  switch (status.state) {
    case 'warming':
      return 'Warming…';
    case 'ready':
      // Every target disabled in Heimdall is a valid state, not a failure —
      // say so rather than claiming a ready-for-offline that warmed nothing.
      return status.loaded === 0 ? 'Nothing enabled' : `Ready offline · ${status.loaded}`;
    case 'partial':
      return `Partly ready — ${status.failed.join(', ')} failed`;
    default:
      return 'Off';
  }
}

export function OfflineModeToggle({ status, ready, onChange }: OfflineModeToggleProps) {
  const on = status.state !== 'off';
  return (
    <div className="offline-toggle">
      <label className="offline-toggle__switch">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={!ready}
          aria-label="Offline mode — load these tools now so they keep working without the bridge"
          onChange={(event) => onChange(event.target.checked)}
        />
        <WifiOffIcon size={16} aria-hidden="true" />
        <span className="offline-toggle__label">Offline</span>
      </label>
      <span
        className={`offline-toggle__pill is-${status.state}`}
        role="status"
        title={
          status.state === 'partial' ? `Could not load: ${status.failed.join(', ')}` : undefined
        }
      >
        {pillText(status)}
      </span>
    </div>
  );
}
