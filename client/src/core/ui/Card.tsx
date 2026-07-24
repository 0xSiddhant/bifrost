import type { ReactNode } from 'react';

/** A plain surface panel. The tone-lit hub/portal card is `Portal` (Portal.tsx). */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `card ${className}` : 'card'}>{children}</section>;
}
