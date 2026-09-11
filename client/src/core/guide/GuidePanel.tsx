import { useEffect, useState } from 'react';
import { renderMarkdown } from '../markdown';
import { log } from '../log';
import { Button } from '../ui/Button';
import { MarkdownPreview } from '../ui/MarkdownPreview';
import { CloseIcon } from '../ui/icons';
import type { Guide } from './registry';

/**
 * The slide-out reference for the format the current page works with (PLAN-30).
 *
 * A right-edge drawer rather than a centred modal, and deliberately not a
 * blocking one: this is material to glance at while working, so the page
 * behind it stays live and focus stays on the bulb that opened it. Closing on
 * `Escape` or a click outside is `GuideButton`'s business, since the bulb
 * itself must not count as "outside" the drawer.
 *
 * Content is loaded here rather than by the button so the button holds no
 * state it does not need: mounting the panel *is* opening it, and the module
 * system caches the import, so re-opening costs no second fetch.
 */
export function GuidePanel({ guide, onClose }: { guide: Guide; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    guide
      .load()
      .then((markdown) => {
        if (!cancelled) setHtml(renderMarkdown(markdown));
      })
      .catch((err: unknown) => {
        // A guide is a bundled chunk, so this is the same class of failure
        // RouteBoundary exists for: the host went away mid-session.
        log.error(`guide: failed to load the ${guide.id} guide: ${(err as Error).message}`, {
          module: 'guide',
        });
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [guide]);

  return (
    <aside className="guide-panel" role="complementary" aria-label={`${guide.title} guide`}>
      <header className="guide-panel__head">
        <h2 className="guide-panel__title">{guide.title}</h2>
        <Button variant="ghost" size="icon" aria-label="Close guide" onClick={onClose}>
          <CloseIcon size={18} />
        </Button>
      </header>

      {html !== null && (
        <MarkdownPreview html={html} className="guide-panel__body" module="guide" />
      )}
      {html === null && !failed && (
        <p className="guide-panel__status caption">Loading the {guide.title} guide…</p>
      )}
      {failed && (
        <p className="guide-panel__status caption">
          The {guide.title} guide could not be loaded. It ships with the app, so this usually means
          the connection to the bridge dropped — try again once it is back.
        </p>
      )}
    </aside>
  );
}
