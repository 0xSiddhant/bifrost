import type { ReactNode } from 'react';
import { hasFeature } from '../../core/features';
import { Portal } from '../../core/ui/Portal';
import { JoinBifrostCard } from '../../core/ui/JoinBifrostCard';
import {
  BookmarkIcon,
  ClipboardIcon,
  DownloadIcon,
  SlidesIcon,
  UploadIcon,
} from '../../core/ui/icons';

/**
 * The transfer doors, plus the shelf. Colour follows position: the Nth *visible*
 * portal takes the Nth card-tone slot, so reordering this list reorders the
 * colours too.
 */
interface Portal {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  go: string;
  /** Card shows only when this build ships the feature (omitted = always). */
  module?: string;
}

const PORTALS: Portal[] = [
  {
    to: '/upload',
    icon: <UploadIcon size={26} />,
    title: 'Send files',
    description: 'Drop files from this device into the hub. They land in a write-only vault on the host.',
    go: 'midgard → asgard',
    module: 'file-transfer',
  },
  {
    to: '/downloads',
    icon: <DownloadIcon size={26} />,
    title: 'Receive files',
    description: 'Everything shared from the host appears here, live — on every device at once.',
    go: 'asgard → midgard',
    module: 'file-transfer',
  },
  {
    to: '/hermes',
    icon: <ClipboardIcon size={26} />,
    title: 'Hermes',
    description: 'A shared clipboard for the bridge — paste text on one device, read it on every other.',
    go: 'one board · every device',
    module: 'clipboard',
  },
  {
    to: '/accio',
    icon: <BookmarkIcon size={26} />,
    // Deliberately next to Hermes: the pair reads as "pass it" vs "keep it".
    title: 'Accio',
    description: 'A shelf for links worth keeping — summon any of them back from any device.',
    go: 'saved · summoned later',
    module: 'accio',
  },
  {
    to: '/saga',
    icon: <SlidesIcon size={26} />,
    // Midgard, not Ollivanders: "drop a file, present it on the shared screen"
    // reads far closer to Send/Receive's audience than to Loki's (PLAN-28).
    title: 'Saga',
    description: 'Present a markdown deck on the big screen — drop a file, or open a saved edda.',
    go: 'a deck · every eye',
    module: 'saga',
  },
];

export function MidgardPage() {
  const portals = PORTALS.filter((portal) => !portal.module || hasFeature(portal.module));

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
        {portals.map((portal, index) => (
          <Portal key={portal.to} tone={index + 1} {...portal} />
        ))}
      </div>

      {/* Not a portal — the wide onboarding band stays its own component. It
          shows the hub's own URL, so the standalone site has none (PLAN-35). */}
      {__HUB__ && (
        <>
          <div className="rune-divider" aria-hidden="true">
            ᛒᛁᚠᚱᛟᛋᛏ
          </div>
          <JoinBifrostCard />
        </>
      )}
    </>
  );
}
