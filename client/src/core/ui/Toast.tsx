import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckIcon } from './icons';

interface ToastProps {
  kind?: 'info' | 'ok' | 'danger';
  /**
   * Transient feedback ("Path copied…") floats over the viewport instead of
   * sitting in flow, so it is visible wherever the page happens to be scrolled.
   * Portalled to <body> so no ancestor's stacking or overflow context traps it.
   * Leave off for banners that belong in the layout.
   */
  floating?: boolean;
  children: ReactNode;
}

export function Toast({ kind = 'info', floating = false, children }: ToastProps) {
  const toast = (
    <div className={kind === 'info' ? 'toast' : `toast toast--${kind}`} role="status">
      {kind !== 'info' && (
        <span className="toast__icon">{kind === 'ok' ? <CheckIcon /> : <AlertIcon />}</span>
      )}
      <span>{children}</span>
    </div>
  );

  if (!floating) return toast;
  return createPortal(<div className="toast-host">{toast}</div>, document.body);
}
