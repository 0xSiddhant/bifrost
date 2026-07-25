import type { ReactNode } from 'react';
import { useCapabilities } from '../../core/useCapabilities';
import { Portal } from '../../core/ui/Portal';
import { GaugeIcon, QrIcon, SparklesIcon } from '../../core/ui/icons';

/**
 * Diagon Alley — the utility toolbox category. A row of small, self-contained
 * tools. "Make a QR" (Sigil) is the one open stall today; the rest are the
 * PLAN-99 toolbox utilities, advertised as coming soon.
 *
 * Card colour follows **position** in this list (see cardToneClass): reorder the
 * tools and the colours reorder with them — nothing hardcodes a per-card colour.
 */
interface Stall {
  title: string;
  description: string;
  go: string;
  icon: ReactNode;
  to?: string;
  module?: string;
  soon?: boolean;
}

const STALLS: Stall[] = [
  {
    title: 'Make a QR',
    description: 'Turn any text or URL into a scannable code you can size and download.',
    go: 'text → scannable',
    icon: <QrIcon size={24} />,
    to: '/sigil',
    module: 'qr-tool',
  },
  {
    title: 'Nimbus',
    description:
      'Measure the Wi-Fi between this device and the bridge: download, upload, latency — with a trend per device.',
    go: 'how fast is your air',
    icon: <GaugeIcon size={24} />,
    to: '/nimbus',
    module: 'nimbus',
  },
  {
    title: 'Base64',
    description: 'Encode and decode Base64 text, entirely in the browser.',
    go: 'encode ⇄ decode',
    icon: <SparklesIcon size={24} />,
    soon: true,
  },
  {
    title: 'UUID',
    description: 'Generate v4 UUIDs on demand, one or many at a time.',
    go: 'unique every time',
    icon: <SparklesIcon size={24} />,
    soon: true,
  },
  {
    title: 'Timestamp',
    description: 'Convert between Unix time and human-readable dates, both ways.',
    go: 'unix ⇄ human',
    icon: <SparklesIcon size={24} />,
    soon: true,
  },
];

export function DiagonAlleyPage() {
  const { capabilities } = useCapabilities();
  const has = (module?: string) => !module || !capabilities || capabilities.modules.includes(module);
  const stalls = STALLS.filter((stall) => has(stall.module));

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">diagon alley · little shops of handy magic</span>
          <h2>Diagon Alley</h2>
          <p>A row of small, self-contained tools. More stalls are opening soon.</p>
        </div>
      </div>

      <div className="portals">
        {stalls.map((stall, index) => (
          <Portal key={stall.title} tone={index + 1} {...stall} />
        ))}
      </div>

      <div className="hub-soon-note">
        <p>
          🪄 The shutters are still up on a few storefronts. Base64, UUID, and timestamp conjuring
          are being stocked — check back soon.
        </p>
      </div>
    </>
  );
}
