import { Link } from 'react-router-dom';
import { useCapabilities } from '../../core/useCapabilities';
import { QrIcon, SparklesIcon } from '../../core/ui/icons';

/**
 * Diagon Alley — the utility toolbox category. A row of small, self-contained
 * tools. "Make a QR" (Sigil) is the one open stall today; the rest are the
 * PLAN-99 toolbox utilities, advertised as coming soon.
 */
const SOON = [
  {
    title: 'Base64',
    desc: 'Encode and decode Base64 text, entirely in the browser.',
  },
  {
    title: 'UUID',
    desc: 'Generate v4 UUIDs on demand, one or many at a time.',
  },
  {
    title: 'Timestamp',
    desc: 'Convert between Unix time and human-readable dates, both ways.',
  },
];

export function DiagonAlleyPage() {
  const { capabilities } = useCapabilities();
  const hasQr = !capabilities || capabilities.modules.includes('qr-tool');

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">diagon alley · little shops of handy magic</span>
          <h2>Diagon Alley</h2>
          <p>A row of small, self-contained tools. More stalls are opening soon.</p>
        </div>
      </div>

      <div className="hub-grid">
        {hasQr && (
          <Link to="/sigil" className="hub-card">
            <span className="hub-card__icon">
              <QrIcon size={22} />
            </span>
            <span className="hub-card__title">Make a QR</span>
            <span className="hub-card__desc">
              Turn any text or URL into a scannable code you can size and download.
            </span>
          </Link>
        )}

        {SOON.map((tool) => (
          <div key={tool.title} className="hub-card hub-card--soon" aria-disabled="true">
            <span className="hub-card__icon">
              <SparklesIcon size={22} />
            </span>
            <span className="hub-card__title">
              {tool.title} <span className="hub-card__badge">Coming soon</span>
            </span>
            <span className="hub-card__desc">{tool.desc}</span>
          </div>
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
