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
  canFullscreen,
  enterFullscreen,
  exitFullscreen,
  fullscreenElement,
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
  /** Real, browser-owned fullscreen. */
  const [fullscreen, setFullscreen] = useState(false);
  /**
   * The stand-in for browsers with no element fullscreen — Safari on iPhone,
   * which has it on `<video>` and nowhere else. There is no call that makes it
   * work there, so instead the page covers the app itself (`.saga--immersive`)
   * and the deck still gets the whole screen.
   */
  const [immersive, setImmersive] = useState(false);
  const presenting = fullscreen || immersive;

  // The browser is the source of truth for the real thing: Esc and F11 both
  // leave without going through the button.
  useEffect(() => {
    const sync = () => setFullscreen(fullscreenElement() === containerRef.current);
    return onFullscreenChange(sync);
  }, []);

  const togglePresenting = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;

    if (fullscreenElement() === element) {
      void exitFullscreen().catch((error: unknown) => {
        log.warn(`saga: could not leave fullscreen: ${(error as Error).message}`, {
          module: 'saga',
        });
      });
      return;
    }
    if (immersive) {
      setImmersive(false);
      return;
    }
    if (!canFullscreen(element)) {
      // Not a failure worth an error: it is the platform, and the fallback is
      // about to give the deck the screen anyway.
      log.info('saga: no element fullscreen here — presenting in-page instead', {
        module: 'saga',
      });
      setImmersive(true);
      return;
    }
    // Deliberately this container and never `document.documentElement`: the
    // browser's own Fullscreen API is then what hides Bifrost's header and nav,
    // so no Saga-specific hiding logic is needed for the real path.
    void enterFullscreen(element).catch((error: unknown) => {
      // A rejected request (an iframe without the permission, a gesture the
      // browser did not accept) would otherwise leave a dead button; fall back
      // rather than strand the presenter.
      log.warn(`saga: fullscreen refused, presenting in-page instead: ${(error as Error).message}`, {
        module: 'saga',
      });
      setImmersive(true);
    });
  }, [immersive]);

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
      if (event.key === 'Escape') {
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        // The browser handles Esc for real fullscreen; the in-page stand-in has
        // nobody else to do it.
        if (immersive) {
          setImmersive(false);
          return;
        }
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
  }, [shortcutsOpen, togglePresenting, immersive, scale]);

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
      className={
        ['saga', presenting && 'saga--presenting', immersive && 'saga--immersive']
          .filter(Boolean)
          .join(' ')
      }
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
        onToggleFullscreen={togglePresenting}
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((open) => !open)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        scale={scale}
      />

      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
