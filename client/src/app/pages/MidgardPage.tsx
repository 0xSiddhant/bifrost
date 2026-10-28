import { lazy, Suspense, type ReactNode } from 'react';
import { withChunkTimeout } from '../../core/chunkError';
import { hasFeature } from '../../core/features';
import { log } from '../../core/log';
import { ChunkBoundary } from '../../core/ui/ChunkBoundary';
import { Portal } from '../../core/ui/Portal';
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
    // Saving an edda needs the hub, so the standalone site offers the file alone.
    description: __HUB__
      ? 'Present a markdown deck on the big screen — drop a file, or open a saved edda.'
      : 'Present a markdown deck or a PDF on the big screen — drop a file and go.',
    go: 'a deck · every eye',
    module: 'saga',
  },
];

/**
 * The Join card's own chunk (PLAN-40): its QR code brings `qrcode`, which the
 * home page used to download before it could paint. An object, so a test can
 * make it fail. Hub-only: the `import()` sits in the branch the standalone
 * build drops, or the card's chunk and its request path would ship there too
 * (PLAN-35, `scripts/check-standalone.ts`).
 */
export const joinCardChunk = {
  load: __HUB__
    ? () => import('../../core/ui/JoinBifrostCard')
    : () => Promise.reject(new Error('the Join card is hub-only')),
};

/**
 * Lazy, below the portals, so it arriving a moment later moves nothing above
 * it. Built once: the card needs the hub anyway, so after a failure there is
 * nothing to offer until the page is reloaded.
 */
const JoinBifrostCard = lazy(() =>
  withChunkTimeout(joinCardChunk.load()).then((module) => ({ default: module.JoinBifrostCard })),
);

function joinCardFailed(error: Error): void {
  log.warn(`midgard: the Join card's chunk could not be loaded: ${error.message}`, {
    module: 'qr-tool',
  });
}

export function MidgardPage() {
  const portals = PORTALS.filter((portal) => !portal.module || hasFeature(portal.module));

  return (
    <>
      <section className="hero">
        <span className="eyebrow">᛫ the rainbow bridge ᛫</span>
        {/* The standalone site is a public tools site with no transfer at all,
            and this heading is what search engines read as its home page. */}
        {__HUB__ ? (
          <>
            <h1>
              Your devices, <span className="hero-accent">connected</span>.
            </h1>
            <p>
              Send and receive files across the bridge — no cloud, no accounts, just your Wi-Fi.
            </p>
          </>
        ) : (
          <>
            <h1>
              Developer tools, <span className="hero-accent">in your browser</span>.
            </h1>
            <p>
              JSON, Markdown, YAML and XML editors, a diff checker, quick utilities and a slide
              presenter — nothing to install, nothing uploaded.
            </p>
          </>
        )}
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
          {/* A missing chunk costs the card, never the page. */}
          <ChunkBoundary onChunkError={joinCardFailed}>
            {/* The card's place is kept while it loads, so nothing shifts. */}
            <Suspense
              fallback={<div className="join-card join-card--placeholder" aria-hidden="true" />}
            >
              <JoinBifrostCard />
            </Suspense>
          </ChunkBoundary>
        </>
      )}
    </>
  );
}
