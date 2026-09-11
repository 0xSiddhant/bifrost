/**
 * The Fullscreen API, across the three behaviours browsers actually have
 * (PLAN-28).
 *
 * 1. **Standard** — `element.requestFullscreen()`. Everything current.
 * 2. **WebKit-prefixed** — `element.webkitRequestFullscreen()`. Safari on macOS
 *    and iPad, and older WebKit builds.
 * 3. **No element fullscreen at all** — Safari on **iPhone**, which exposes the
 *    Fullscreen API on `<video>` and nowhere else. This is a platform fact, not
 *    a bug to work around: there is no call that will make it work, so `can()`
 *    reports false and the page presents itself instead (see
 *    `.saga--immersive`), rather than offering a button that cannot fire.
 */

interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface WebkitDocument extends Document {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
}

const doc = (): WebkitDocument => document as WebkitDocument;

/**
 * Whether this browser can put an element into real fullscreen at all.
 *
 * Asked of the **environment**, not of a particular node, and deliberately so:
 * the answer decides whether the control is rendered, and the container does
 * not exist yet on a deck that has not loaded. Reading it off an element meant
 * the question was asked while the ref was still null, so the control never
 * appeared for a dropped file — caught by a test, after the first attempt.
 *
 * `fullscreenEnabled` is the second half: it is `false` inside an iframe
 * without `allowfullscreen`, where the method exists and always rejects. It is
 * `undefined` in environments that implement none of this, which must not read
 * as a refusal, hence the explicit `!== false`.
 */
export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const proto = Element.prototype as WebkitElement;
  const hasMethod =
    typeof proto.requestFullscreen === 'function' ||
    typeof proto.webkitRequestFullscreen === 'function';
  const enabled = doc().fullscreenEnabled ?? (doc() as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled;
  return hasMethod && enabled !== false;
}

/** The element the browser currently considers fullscreen, either spelling. */
export function fullscreenElement(): Element | null {
  return doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;
}

export async function enterFullscreen(element: HTMLElement): Promise<void> {
  const el = element as WebkitElement;
  if (typeof el.requestFullscreen === 'function') {
    await el.requestFullscreen();
    return;
  }
  if (typeof el.webkitRequestFullscreen === 'function') {
    await el.webkitRequestFullscreen();
    return;
  }
  throw new Error('this browser has no element fullscreen');
}

export async function exitFullscreen(): Promise<void> {
  const d = doc();
  if (typeof d.exitFullscreen === 'function') {
    await d.exitFullscreen();
    return;
  }
  if (typeof d.webkitExitFullscreen === 'function') {
    await d.webkitExitFullscreen();
  }
}

/**
 * Subscribe to fullscreen changes. Both event names are always bound: which one
 * fires is the browser's business, and a browser that sends both simply reports
 * the same state twice, which is a no-op for the caller.
 */
export function onFullscreenChange(handler: () => void): () => void {
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
  };
}
