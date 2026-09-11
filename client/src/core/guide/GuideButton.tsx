import { useEffect, useRef, useState } from 'react';
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
 * The container wrapping the bulb and the drawer is what makes "click outside
 * to close" work, exactly as it does for ThemeSwitcher's popover next door:
 * the drawer is `position: fixed` but still a DOM descendant, so a click on
 * either is inside, and the bulb's own click stays a plain toggle instead of
 * racing a close.
 */
export function GuideButton() {
  const { pathname } = useLocation();
  const guide = guideForRoute(pathname);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Navigating away from the page a drawer was opened on closes it: the guide
  // is about *this* page's format, so carrying it to the next one would be
  // showing the wrong reference.
  const guideId = guide?.id;
  useEffect(() => setOpen(false), [guideId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!guide) return null;

  return (
    <div className="guide-button" ref={containerRef}>
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
