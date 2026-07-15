import { Link } from 'react-router-dom';
import { PortalCard } from '../../core/ui/Card';
import { DownloadIcon, UploadIcon } from '../../core/ui/icons';

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
        <PortalCard
          to="/upload"
          tone="teal"
          icon={<UploadIcon size={26} />}
          title="Send files"
          description="Drop files from this device into the hub. They land in a write-only vault on the host."
          go="midgard → asgard"
        />
        <PortalCard
          to="/downloads"
          tone="violet"
          icon={<DownloadIcon size={26} />}
          title="Receive files"
          description="Everything shared from the host appears here, live — on every device at once."
          go="asgard → midgard"
        />
      </div>

      <div className="rune-divider" aria-hidden="true">
        ᛒᛁᚠᚱᛟᛋᛏ
      </div>

      <p className="midgard-links caption">
        Also on the bridge: <Link to="/clipboard">Clipboard sync</Link> ·{' '}
        <Link to="/qr">QR tool</Link>
      </p>
    </>
  );
}
