import { Link } from 'react-router-dom';
import { useCapabilities } from '../../core/useCapabilities';
import { BracesIcon, DiffIcon, DocFileIcon } from '../../core/ui/icons';

/**
 * Ollivanders — the developer tools category ("the tool chooses the maker").
 * A hub of cards for the structured-text tools; each links to its own page.
 * Edda is advertised as coming soon until PLAN-11 lands.
 */
export function OllivandersPage() {
  const { capabilities } = useCapabilities();
  const has = (module: string) => !capabilities || capabilities.modules.includes(module);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">ollivanders · the tool chooses the maker</span>
          <h2>Ollivanders</h2>
          <p>Instruments for shaping data and documents. Pick the one that fits the job.</p>
        </div>
      </div>

      <div className="hub-grid">
        {has('runestone') && (
          <Link to="/runestone" className="hub-card">
            <span className="hub-card__icon">
              <BracesIcon size={22} />
            </span>
            <span className="hub-card__title">Runestone</span>
            <span className="hub-card__desc">
              Validate, explore, and shape JSON — code and tree views, saved to the Pensieve.
            </span>
          </Link>
        )}

        {has('variant') && (
          <Link to="/variant" className="hub-card">
            <span className="hub-card__icon">
              <DiffIcon size={22} />
            </span>
            <span className="hub-card__title">Variant</span>
            <span className="hub-card__desc">
              Compare two JSON or text documents structurally, side by side, and jump between the
              differences.
            </span>
          </Link>
        )}

        <div className="hub-card hub-card--soon" aria-disabled="true">
          <span className="hub-card__icon">
            <DocFileIcon size={22} />
          </span>
          <span className="hub-card__title">
            Edda <span className="hub-card__badge">Coming soon</span>
          </span>
          <span className="hub-card__desc">
            A Markdown workspace with live preview and its own library — next to be carved onto the
            bridge.
          </span>
        </div>
      </div>
    </>
  );
}
