import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { withChunkTimeout } from '../chunkError';
import { log } from '../log';
import { notify } from '../notify';
import { Button } from '../ui/Button';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { LightbulbIcon } from '../ui/icons';
import { guideForRoute } from './registry';

/**
 * The panel's own chunk (PLAN-40). It carries the whole Markdown stack (marked,
 * highlight.js, DOMPurify), which every page used to download for a panel that
 * opens only on a click. One object, so offline mode warms the very same
 * import and a test can make it fail.
 */
export const guidePanelChunk = {
  load: () => import('./GuidePanel'),
};

/**
 * A fresh lazy panel. React caches a rejected `lazy()` for the life of the
 * payload (`app/lazyPages.tsx`'s note), so after a failure the next click
 * builds a new one and is a real second attempt.
 */
function lazyPanel() {
  return lazy(() =>
    withChunkTimeout(guidePanelChunk.load()).then((module) => ({ default: module.GuidePanel })),
  );
}

/** A vanished host never refuses, so the probe needs its own patience limit. */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * Is the server the chunks come from answering? It decides what a failure
 * means. If it is not, the connection is the problem and a later click can
 * work. If it is, the chunk itself is gone (the hub was rebuilt since this tab
 * loaded) or the browser remembers it failing, and only a reload helps.
 */
async function shellAnswers(): Promise<boolean> {
  try {
    const response = await fetch('/index.html', {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    // Any failure here is the answer: unreachable. The chunk failure it
    // accompanies is already logged.
    return false;
  }
}

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
  const [Panel, setPanel] = useState(lazyPanel);

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

  // The bulb and the rest of the shell stay as they were: the panel closes,
  // the person hears why, and the next click starts from a fresh payload.
  const panelFailed = useCallback((error: Error) => {
    setOpen(false);
    setPanel(() => lazyPanel());
    log.warn(`guide: the panel's chunk could not be loaded: ${error.message}`, { module: 'guide' });
    void shellAnswers().then((answers) =>
      notify.error(
        answers
          ? "The guide's code has to be fetched again, and only a reload can. Reload the page to open it."
          : "The guide couldn't load. Check the connection and try again.",
        { dedupeKey: 'guide-unavailable' },
      ),
    );
  }, []);

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

      {open && (
        <ChunkBoundary onChunkError={panelFailed}>
          {/* Nothing while it arrives: over the LAN that is a moment. */}
          <Suspense fallback={null}>
            <Panel guide={guide} onClose={() => setOpen(false)} />
          </Suspense>
        </ChunkBoundary>
      )}
    </div>
  );
}
