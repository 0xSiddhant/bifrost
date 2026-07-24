import type { ReactNode } from 'react';
import { Portal } from '../../core/ui/Portal';
import { JoinBifrostCard } from '../../core/ui/JoinBifrostCard';
import { ClipboardIcon, DownloadIcon, UploadIcon } from '../../core/ui/icons';

/**
 * The three transfer doors. Colour follows position: the Nth portal takes the
 * Nth card-tone slot, so reordering this list reorders the colours too.
 */
interface Portal {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  go: string;
}

const PORTALS: Portal[] = [
  {
    to: '/upload',
    icon: <UploadIcon size={26} />,
    title: 'Send files',
    description: 'Drop files from this device into the hub. They land in a write-only vault on the host.',
    go: 'midgard → asgard',
  },
  {
    to: '/downloads',
    icon: <DownloadIcon size={26} />,
    title: 'Receive files',
    description: 'Everything shared from the host appears here, live — on every device at once.',
    go: 'asgard → midgard',
  },
  {
    to: '/hermes',
    icon: <ClipboardIcon size={26} />,
    title: 'Hermes',
    description: 'A shared clipboard for the bridge — paste text on one device, read it on every other.',
    go: 'one board · every device',
  },
];

export function MidgardPage() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">᛫ the rainbow bridge ᛫</span>
        <h1>
          Your devices, <span className="hero-accent">connected</span>.
        </h1>
        <p>Send and receive files across the bridge — no cloud, no accounts, just your Wi-Fi.</p>
      </section>

      <div className="portals">
        {PORTALS.map((portal, index) => (
          <Portal key={portal.to} tone={index + 1} {...portal} />
        ))}
      </div>

      <div className="rune-divider" aria-hidden="true">
        ᛒᛁᚠᚱᛟᛋᛏ
      </div>

      {/* Not a portal — the wide onboarding band stays its own component. */}
      <JoinBifrostCard />
    </>
  );
}
