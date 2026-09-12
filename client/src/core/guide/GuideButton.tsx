import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../ui/Button';
import { LightbulbIcon } from '../ui/icons';
import { GuidePanel } from './GuidePanel';
import { guideForRoute } from './registry';

/**
 * The header's bulb: a quick recap of the format the current page works with
 * (PLAN-30).
 *
 * Mounted once for every route rather than per page. On a route the registry
 * knows nothing about — Midgard, Pensieve, Variant — it renders nothing at
 * all, not a disabled button: there is no guide to point at, so there is
 * nothing to click.
 *
 * Closing is split: `Escape` belongs here, because it is a window-level key no
 * matter what has focus, while "click outside" belongs to the panel's own
 * scrim, which covers the page and knows exactly what outside means. That is
 * simpler than ThemeSwitcher's contains()-on-a-container trick next door, and
 * it has to be — the panel portals out to `document.body`, so it is no longer
 * a DOM descendant of anything here.
 */
export function GuideButton() {
  const { pathname } = useLocation();
  const guide = guideForRoute(pathname);
  const [open, setOpen] = useState(false);

  // Navigating away from the page a drawer was opened on closes it: the guide
  // is about *this* page's format, so carrying it to the next one would be
  // showing the wrong reference.
  const guideId = guide?.id;
  useEffect(() => setOpen(false), [guideId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!guide) return null;

  return (
    <div className="guide-button">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${guide.title} guide`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <LightbulbIcon size={18} />
      </Button>

      {open && <GuidePanel guide={guide} onClose={() => setOpen(false)} />}
    </div>
  );
}
