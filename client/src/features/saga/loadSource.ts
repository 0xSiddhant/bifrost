import { fetchEdda } from '../../core/edda';
import { parseSlides, type Slide } from './parseSlides';

/**
 * The one loader behind all three of Saga's content sources (PLAN-28).
 *
 * Reduced to its real job, the feature is: get markdown text, hand it to
 * `parseSlides`. Each source is only a different way of producing that text —
 * a saved edda through `core/edda.ts`, and a dropped file or a CLI-served file
 * through a URL. `SagaPage` never learns which one it got, so a fourth source
 * would land here and nowhere else.
 */

export interface SagaDeck {
  /** Document name for the page heading; a URL source has none of its own. */
  title: string | null;
  slides: Slide[];
}

/**
 * Fetch a URL and parse what comes back as markdown.
 *
 * Used by both the drag-drop path (an `URL.createObjectURL` blob URL, so this
 * request never leaves the browser) and the terminal path (`?source=`, pointing
 * at the one-shot server `bifrost preview` runs on the operator's own machine).
 *
 * A caller-supplied `?source=` is deliberately not restricted to those two: the
 * worst case is misleading text rendered inside the trusted origin, because
 * `renderMarkdown` runs everything through DOMPurify — the same already-accepted
 * boundary every other consumer of that pipeline sits behind.
 */
export async function loadFromUrl(url: string): Promise<SagaDeck> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`source responded ${response.status}`);
  }
  return { title: null, slides: parseSlides(await response.text()) };
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
 */
export async function loadFromSlug(slug: string): Promise<SagaEddaDeck | null> {
  const doc = await fetchEdda(slug);
  if (!doc) return null;
  return { title: doc.name, slug: doc.slug, slides: parseSlides(doc.content) };
}
