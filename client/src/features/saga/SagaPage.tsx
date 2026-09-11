import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { log } from '../../core/log';
import { Dropzone } from './Dropzone';
import { NotesPanel } from './NotesPanel';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { SlideFooter } from './SlideFooter';
import { SlideView } from './SlideView';
import { loadFromSlug, loadFromUrl } from './loadSource';
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenElement,
  fullscreenSupported,
  onFullscreenChange,
} from './fullscreen';
import { useSlideScale } from './useSlideScale';
import { useSlideshowNav } from './useSlideshowNav';
import type { Slide } from './parseSlides';
import './saga.css';

/**
 * Saga (PLAN-28) — a fullscreen slideshow over a saved edda or a dropped file.
 *
 * One component serves `/saga` and `/saga/:slug`, the same way `EddaPage`
 * already serves both the bare and the slugged form of its own route. Which of
 * the three sources produced the deck is entirely `loadSource`'s business:
 * everything below works from a `Slide[]`.
 */
type Phase = 'idle' | 'loading' | 'ready' | 'notfound' | 'error';

export function SagaPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const source = searchParams.get('source');

  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(slug || source ? 'loading' : 'idle');

  // A dropped file's bytes are already in memory; this gives them a fetchable
  // address without copying them anywhere. Revoked on unmount and before the
  // next drop, so a long session cannot accumulate them.
  useEffect(() => {
    if (!file) return;
    const created = URL.createObjectURL(file);
    setObjectUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);

  // The name and the phase move at drop time, not when the object URL lands a
  // tick later — otherwise the dropzone stays on screen for that tick, which
  // reads as the drop not having registered.
  const handleFile = useCallback((dropped: File) => {
    setFile(dropped);
    setTitle(dropped.name);
    setPhase('loading');
  }, []);

  const url = objectUrl ?? source;

  useEffect(() => {
    let cancelled = false;
    if (slug) {
      setPhase('loading');
      loadFromSlug(slug)
        .then((deck) => {
          if (cancelled) return;
          if (!deck) {
            setPhase('notfound');
            return;
          }
          setSlides(deck.slides);
          setTitle(deck.title);
          setPhase('ready');
          if (deck.slug !== slug) navigate(`/saga/${deck.slug}`, { replace: true });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPhase('error');
          // Without this the page reads as an unexplained blank in front of an
          // audience, and nothing else records why the deck never opened.
          log.reportError('saga: could not load the saved edda', error, {
            module: 'saga',
          });
        });
      return () => {
        cancelled = true;
      };
    }

    if (url) {
      setPhase('loading');
      loadFromUrl(url)
        .then((deck) => {
          if (cancelled) return;
          setSlides(deck.slides);
          setPhase('ready');
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPhase('error');
          // The CLI's one-shot server having already closed, or a dropped file
          // that could not be read, both land here and look identical on screen.
          log.reportError('saga: could not load the deck source', error, { module: 'saga' });
        });
      return () => {
        cancelled = true;
      };
    }

    setPhase('idle');
    return () => {
      cancelled = true;
    };
  }, [slug, url, navigate]);

  // ------------------------------------------------------------- presenting --
  const containerRef = useRef<HTMLDivElement>(null);
  const [presenting, setPresenting] = useState(false);
  /**
   * Whether this browser can fullscreen an element at all. Safari on **iPhone**
   * cannot — it has the Fullscreen API on `<video>` and nowhere else — so there
   * the control is not offered rather than offered and dead. An environment
   * fact, so it is read once and never changes for the life of the tab.
   */
  const [canPresent] = useState(fullscreenSupported);

  // The browser is the source of truth: Esc and F11 both leave without going
  // through the button.
  useEffect(() => {
    const sync = () => setPresenting(fullscreenElement() === containerRef.current);
    return onFullscreenChange(sync);
  }, []);

  const togglePresenting = useCallback(() => {
    const element = containerRef.current;
    if (!element || !fullscreenSupported()) return;

    if (fullscreenElement() === element) {
      void exitFullscreen().catch((error: unknown) => {
        log.warn(`saga: could not leave fullscreen: ${(error as Error).message}`, {
          module: 'saga',
        });
      });
      return;
    }
    // Deliberately this container and never `document.documentElement`: the
    // browser's own Fullscreen API is then what hides Bifrost's header and nav,
    // so no Saga-specific hiding logic is needed at all.
    void enterFullscreen(element).catch((error: unknown) => {
      // A rejected request — an iframe without the permission, a gesture the
      // browser declined — leaves a control that looks broken, and nothing here
      // can retry it for the presenter.
      log.warn(`saga: fullscreen refused: ${(error as Error).message}`, { module: 'saga' });
    });
  }, []);

  // ------------------------------------------------------------ interaction --
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const nav = useSlideshowNav(slides.length, { disabled: shortcutsOpen });
  // Held here rather than in the footer, so the size a presenter picked
  // survives entering and leaving fullscreen — the footer re-renders across
  // that switch, this component does not remount.
  const scale = useSlideScale();

  const current = slides[nav.index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape' && shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      if (event.key === '?' || event.key === 'h' || event.key === 'H') {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if (shortcutsOpen) return;
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        togglePresenting();
        return;
      }
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        setNotesOpen((open) => !open);
        return;
      }
      // `=` is the unshifted key `+` lives on, so both reach the same place.
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        scale.inc();
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        scale.dec();
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        scale.reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsOpen, togglePresenting, scale]);

  const heading = title ?? 'This deck';

  // ----------------------------------------------------------------- render --
  if (phase === 'idle') {
    return <Dropzone onFile={handleFile} />;
  }

  if (phase === 'loading') {
    return <div className="page-loading caption">Raising the deck…</div>;
  }

  if (phase === 'notfound' || phase === 'error') {
    return (
      <div className="page-head">
        <div>
          <span className="eyebrow">᛫ saga ᛫</span>
          <h2>{phase === 'notfound' ? 'This deck was never written' : 'Could not open this deck'}</h2>
          <p>
            <Link to="/pensieve?type=edda">Back to the Pensieve</Link>
          </p>
        </div>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="page-head">
        <div>
          <span className="eyebrow">᛫ saga ᛫</span>
          <h2>Nothing to present</h2>
          <p>
            {heading} has no slides in it — Saga splits a document on a <code>---</code> line, and
            an empty document has nothing to split.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={presenting ? 'saga saga--presenting' : 'saga'}
      data-testid="saga-container"
      // A multiplier, not a size: each mode keeps its own base — windowed reads
      // at a page's measure, fullscreen scales with the viewport — and this
      // moves both together.
      style={{ '--saga-scale': scale.value } as CSSProperties}
    >
      <div className="saga-stage" {...nav.touchHandlers}>
        <SlideView markdown={current?.body ?? ''} />
        {notesOpen && <NotesPanel notes={current?.notes ?? null} />}
      </div>

      <SlideFooter
        index={nav.index}
        count={slides.length}
        onPrevious={nav.previous}
        onNext={nav.next}
        fullscreen={presenting}
        canFullscreen={canPresent}
        onToggleFullscreen={togglePresenting}
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((open) => !open)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        scale={scale}
      />

      {shortcutsOpen && (
        <ShortcutsOverlay canFullscreen={canPresent} onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}
