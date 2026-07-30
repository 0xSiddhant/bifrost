import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckIcon, CloseIcon } from '../ui/icons';
import { notifications } from './notify';
import type { Notification } from './store';
import './notify.css';

/**
 * The one place notifications render. Mounted once in `App.tsx` outside
 * `<Routes>` so a notification raised on one page survives navigation to
 * another, and portalled to `<body>` so no page's stacking or overflow
 * context can trap it (the lesson from the floating Toast).
 */
export function NotificationHost() {
  const state = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot);

  if (state.visible.length === 0) return null;

  return createPortal(
    <div className="notify-host">
      {state.errorCount > 1 && (
        <div className="notify-host__bulk">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => notifications.dismissErrors()}
          >
            Dismiss all errors ({state.errorCount})
          </button>
        </div>
      )}
      {state.visible.map((entry) => (
        <NotificationCard key={entry.id} entry={entry} />
      ))}
      {state.overflow > 0 && (
        <div className="notify-host__overflow caption">+{state.overflow} more</div>
      )}
    </div>,
    document.body,
  );
}

function NotificationCard({ entry }: { entry: Notification }) {
  const isError = entry.kind === 'error';
  return (
    <div
      className={`notify notify--${entry.kind}`}
      // Errors interrupt; everything else waits its turn.
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      onMouseEnter={() => notifications.pause(entry.id)}
      onMouseLeave={() => notifications.resume(entry.id)}
      onFocus={() => notifications.pause(entry.id)}
      onBlur={() => notifications.resume(entry.id)}
    >
      {entry.kind !== 'info' && (
        <span className="notify__icon" aria-hidden="true">
          {isError ? <AlertIcon size={16} /> : <CheckIcon size={16} />}
        </span>
      )}
      <div className="notify__body">
        {entry.title && <strong className="notify__title">{entry.title}</strong>}
        <span className="notify__message">{entry.message}</span>
      </div>
      {entry.count > 1 && (
        <span className="notify__count" aria-label={`repeated ${entry.count} times`}>
          ×{entry.count}
        </span>
      )}
      <button
        type="button"
        className="notify__close"
        aria-label={`Dismiss notification: ${entry.message}`}
        onClick={() => notifications.dismiss(entry.id)}
      >
        <CloseIcon size={14} />
      </button>
      {entry.timeout > 0 && (
        // Keyed on the epoch so a collapsed repeat restarts the countdown bar
        // instead of leaving it wherever the first one had got to.
        <div className="notify__progress" key={entry.epoch} aria-hidden="true">
          <span
            style={{
              animationDuration: `${entry.timeout}ms`,
              animationPlayState: entry.paused ? 'paused' : 'running',
            }}
          />
        </div>
      )}
    </div>
  );
}
