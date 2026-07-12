import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <span className="empty__icon">{icon}</span>
      <span className="empty__title">{title}</span>
      {hint && <span className="caption">{hint}</span>}
      {action}
    </div>
  );
}
