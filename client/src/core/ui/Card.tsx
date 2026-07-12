import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `card ${className}` : 'card'}>{children}</section>;
}

interface PortalCardProps {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  /** Each portal is lit by its own aurora tone. */
  tone: 'teal' | 'violet';
  go?: string;
}

/** The two big doors on Home: Upload / Download. */
export function PortalCard({ to, icon, title, description, tone, go }: PortalCardProps) {
  return (
    <Link to={to} className={`portal-card portal-card--${tone}`}>
      <span className="portal-card__icon">{icon}</span>
      <span className="portal-card__title">{title}</span>
      <span className="portal-card__desc">{description}</span>
      {go && <span className="portal-card__go">{go} →</span>}
    </Link>
  );
}
