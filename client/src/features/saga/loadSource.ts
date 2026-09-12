import { fetchEdda } from '../../core/edda';
import { loadPdfDeck, type PdfDeck } from './loadPdfSlides';
import { parseSlides, type Slide } from './parseSlides';

/**
 * The one loader behind all of Saga's content sources (PLAN-28, PLAN-29).
 *
 * PLAN-28's job was: get markdown text, hand it to `parseSlides`. PLAN-29 gives
 * that a real second branch — a PDF, whose pages are slides — and the whole
 * point of putting the fork here is that nothing downstream learns about it.
 * `SagaPage`, `useSlideshowNav`, fullscreen and the shortcuts overlay all work
 * from a `SagaSlide[]` and an index, exactly as before.
 */

/**
 * A slide is one of two real shapes, tagged rather than inferred.
 *
 * PLAN-28 never had to distinguish, so "the current slide" could be assumed to
 * be markdown everywhere. It no longer can: a rasterized PDF page has no
 * markdown source and therefore no presenter note — not "an empty note", which
 * is a different thing the markdown branch already has its own answer for. The
 * tag makes every consumer say which one it means.
 */
export type SagaSlide = ({ kind: 'markdown' } & Slide) | { kind: 'pdf'; page: number; deck: PdfDeck };

export interface SagaDeck {
  /** Document name for the page heading; a URL source has none of its own. */
  title: string | null;
  slides: SagaSlide[];
  /**
   * Release what the deck holds open. A PDF holds a worker and a parsed
   * document; markdown holds nothing, so this is `null` there rather than a
   * no-op function — the caller can then see there is nothing to release.
   */
  dispose: (() => void) | null;
}

/** `application/pdf`, ignoring any `; charset=…` the server tacked on. */
function isPdfContentType(header: string | null): boolean {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() === 'application/pdf';
}

/** Every PDF opens with this, by the specification — not a heuristic. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Fetch a URL and present whatever comes back.
 *
 * Used by both the drag-drop path (an `URL.createObjectURL` blob URL, so this
 * request never leaves the browser) and the terminal path (`?source=`, pointing
 * at the one-shot server `bifrost preview` runs on the operator's own machine).
 *
 * **One fetch, then decide.** The response body is read once as bytes and then
 * either decoded as text or handed to pdf.js, rather than sniffed and fetched
 * again: the CLI's server serves its payload exactly once and closes, so a
 * second request would find nothing there.
 *
 * The `Content-Type` header decides — `application/pdf` from `core/localServe`
 * for the terminal path, the dropped `File`'s own type for a blob URL. The
 * magic-byte check behind it is for the case that actually happens rather than
 * a theoretical one: a browser that could not name a dropped file's type hands
 * back an empty or `application/octet-stream` type, and the deck would
 * otherwise be presented as one slide of mojibake.
 *
 * A caller-supplied `?source=` is deliberately not restricted to those two: the
 * worst case is misleading text rendered inside the trusted origin, because
 * `renderMarkdown` runs everything through DOMPurify — the same already-accepted
 * boundary every other consumer of that pipeline sits behind. A PDF is narrower
 * still: it is decoded to pixels, and nothing in it reaches the DOM.
 */
export async function loadFromUrl(url: string): Promise<SagaDeck> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`source responded ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (isPdfContentType(response.headers.get('Content-Type')) || startsWithPdfMagic(bytes)) {
    const deck = await loadPdfDeck(bytes);
    const slides: SagaSlide[] = Array.from({ length: deck.pageCount }, (_unused, index) => ({
      kind: 'pdf',
      page: index + 1,
      deck,
    }));
    return { title: null, slides, dispose: () => void deck.destroy() };
  }

  return { title: null, slides: markdownSlides(new TextDecoder().decode(bytes)), dispose: null };
}

/** `parseSlides`' result, tagged for the shape every consumer now branches on. */
function markdownSlides(markdown: string): SagaSlide[] {
  return parseSlides(markdown).map((slide) => ({ kind: 'markdown', ...slide }));
}

/** What a saved edda resolved to — `null` when there is no such document. */
export interface SagaEddaDeck extends SagaDeck {
  /** The canonical slug: a stale one 301s, and the address bar wants fixing. */
  slug: string;
}

/**
 * Present a saved edda by slug.
 *
 * `fetchEdda` already follows the API's stale-slug 301 transparently and
 * already returns `null` on a 404, so both behaviours are reused here rather
 * than re-derived against a raw `fetch` — which is also why this is a `core/`
 * import and not a reach into `features/edda/`.
 *
 * Always markdown: a saved edda is markdown by definition, and PLAN-29 adds no
 * way to store a PDF as a document.
 */
export async function loadFromSlug(slug: string): Promise<SagaEddaDeck | null> {
  const doc = await fetchEdda(slug);
  if (!doc) return null;
  return { title: doc.name, slug: doc.slug, slides: markdownSlides(doc.content), dispose: null };
}
