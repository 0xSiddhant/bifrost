import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cardToneClass } from './cardTone';

interface PortalProps {
  /** 1-based position within its grid — colour follows position (see cardToneClass). */
  tone: number;
  icon: ReactNode;
  title: string;
  description: string;
  /** Footer tagline naming where the portal leads. */
  go: string;
  /** Navigation target. Omitted (or with `soon`) renders a non-navigating card. */
  to?: string;
  /** Coming-soon: dimmed, non-navigating, shows a badge and no arrow. */
  soon?: boolean;
}

/**
 * Portal — the one card used across every hub (Midgard doors, Ollivanders tools,
 * Diagon Alley stalls). A doorway to another dimension of the app; its footer
 * tagline names where it leads.
 */
export function Portal({ tone, icon, title, description, go, to, soon }: PortalProps) {
  const className = `portal ${cardToneClass(tone)}${soon ? ' portal--soon' : ''}`;
  const inner = (
    <>
      <span className="portal__icon">{icon}</span>
      <span className="portal__title">
        {title}
        {soon && <span className="portal__badge">Coming soon</span>}
      </span>
      <span className="portal__desc">{description}</span>
      <span className="portal__go">{soon ? go : `${go} →`}</span>
    </>
  );

  if (to && !soon) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={className} aria-disabled={soon ? 'true' : undefined}>
      {inner}
    </div>
  );
}
