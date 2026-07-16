import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon } from './icons';

interface ToastProps {
  kind?: 'info' | 'ok' | 'danger';
  children: ReactNode;
}

export function Toast({ kind = 'info', children }: ToastProps) {
  return (
    <div className={kind === 'info' ? 'toast' : `toast toast--${kind}`} role="status">
      {kind !== 'info' && (
        <span className="toast__icon">{kind === 'ok' ? <CheckIcon /> : <AlertIcon />}</span>
      )}
      <span>{children}</span>
    </div>
  );
}
