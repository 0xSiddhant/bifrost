import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown, useMermaidDiagrams } from '../../core/markdown';
import { log } from '../../core/log';
import type { PdfDeck } from './loadPdfSlides';
import type { SagaSlide } from './loadSource';

/**
 * One slide (PLAN-28, PLAN-29).
 *
 * A slide is now one of two real things, and this is where that fork is made
 * visible: markdown through `core/markdown`'s one pipeline, or a PDF page
 * rasterized onto a canvas. Both sit inside the same `.saga-slide` frame, so
 * every shell behaviour above them — navigation, fullscreen, the scale control
 * — works identically without knowing which it got.
 */
export function SlideView({ slide, scale }: { slide: SagaSlide | undefined; scale: number }) {
  if (slide?.kind === 'pdf') {
    // Keyed on the page so a canvas is never reused across pages: switching
    // slides then cannot show the previous page's pixels while the next one
    // rasterizes.
    return <PdfSlide key={slide.page} deck={slide.deck} page={slide.page} scale={scale} />;
  }
  return <MarkdownSlide markdown={slide?.body ?? ''} />;
}

/**
 * `features/edda/MarkdownPreview` does the same job and is deliberately *not*
 * reused: a feature may not import another feature. The one thing worth
 * carrying over from it is the memoized `__html` object — React compares that
 * prop by identity, so an inline literal re-sets `innerHTML` on every render
 * and throws away the mermaid diagrams the pass just swapped in.
 */
function MarkdownSlide({ markdown }: { markdown: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  useMermaidDiagrams(ref, html, 'saga');
  const markup = useMemo(() => ({ __html: html }), [html]);

  return (
    <div className="saga-slide">
      <div ref={ref} className="md-preview saga-slide__body" dangerouslySetInnerHTML={markup} />
    </div>
  );
}

/**
 * A rasterized PDF page.
 *
 * The page is re-rendered rather than re-scaled whenever the frame it has to
 * fit changes — a resize, entering or leaving fullscreen, a `+`/`-` step —
 * because a canvas stretched by CSS is a blurry canvas, and a presentation is
 * the one place that shows. Successive changes are coalesced into one render
 * per frame: dragging a window edge otherwise queues a rasterization per pixel.
 *
 * The scale control means the same thing here as it does on a markdown slide,
 * just applied one level down: it multiplies the box the page is fitted into,
 * so a zoomed-in page overflows the frame and the frame scrolls, exactly as
 * zoomed-in markdown already does.
 */
function PdfSlide({ deck, page, scale }: { deck: PdfDeck; page: number; scale: number }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;

    let done = false;
    let frameId = 0;

    const draw = () => {
      frameId = 0;
      if (done) return;
      const box = { width: frame.clientWidth * scale, height: frame.clientHeight * scale };
      // A frame with no size yet: the observer fires again once it has one.
      if (box.width <= 0 || box.height <= 0) return;
      deck
        .renderPage(page, canvas, box)
        .then((rendered) => {
          if (done) return;
          setSize(rendered);
          setFailed(false);
        })
        .catch((error: unknown) => {
          if (done) return;
          setFailed(true);
          // A page that will not rasterize is a blank frame in front of an
          // audience, and nothing else records which page or why.
          log.reportError(`saga: could not render pdf page ${page}`, error, { module: 'saga' });
        });
    };

    const schedule = () => {
      if (frameId === 0) frameId = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(frame);
    schedule();

    return () => {
      done = true;
      if (frameId !== 0) cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [deck, page, scale]);

  return (
    <div className="saga-slide">
      <div ref={frameRef} className="saga-slide__body saga-slide__page">
        <canvas
          ref={canvasRef}
          className="saga-slide__canvas"
          // The raster is oversampled to the device pixel ratio; these are the
          // CSS pixels it should occupy, so it is drawn sharp and at size.
          style={size ? { width: `${size.width}px`, height: `${size.height}px` } : undefined}
          role="img"
          aria-label={`Page ${page}`}
        />
        {failed && (
          <p className="saga-slide__failed caption" role="alert">
            This page could not be drawn.
          </p>
        )}
      </div>
    </div>
  );
}
