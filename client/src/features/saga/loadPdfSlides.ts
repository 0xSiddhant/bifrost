import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { log } from '../../core/log';

/**
 * A PDF as a deck of rasterized pages (PLAN-29).
 *
 * Three findings from the plan's mandated spike are baked into this file, and
 * each one is a branch that was actually taken rather than a precaution:
 *
 * **The `legacy/` build, not the default one.** `pdfjs-dist` 6.x calls
 * `Promise.try`, which is Chrome 128+, Safari 18.2+, Firefox 134+ and Node 23+.
 * The default build therefore throws `Promise.try is not a function` outright
 * on Node 22 — proven here, so the unit tests could not run against it — and on
 * any iPad or iPhone more than a release or two old, which is exactly the
 * hardware this app exists to serve on a LAN. The `legacy/` build bundles
 * core-js and polyfills it. That is the whole reason `legacy/` exists — and it
 * lowers the *browser* floor only, deliberately not the Node one: the package
 * declares `engines: node >=22.13.0`, while this repo builds and tests on Node
 * 20. Nothing shipped pays for that, since no Node process here ever loads
 * pdf.js, but the unit tests have to supply `Promise.withResolvers` themselves —
 * see `__fixtures__/pdfjsUnderNode.ts` for why that is a test-runner gap and not
 * a browser-support one.
 *
 * **The default worker, not `disableWorker`.** The plan named main-thread
 * rendering as the documented fallback if Vite could not be made to emit the
 * worker. It could: a `?url` import gets the worker emitted as its own hashed
 * asset and hands back its built path, which is why the line below works
 * against `npm run build` output and not only under the dev server.
 *
 * **No `standardFontDataUrl`.** pdf.js warns about it under Node, which is
 * misleading here: `useSystemFonts` defaults to `!isNodeJS`, so in a browser
 * the standard 14 fonts resolve against the machine's own fonts and the 820 KB
 * of font data does not need shipping. CJK decks needing `cMapUrl` (another
 * 1.7 MB) are the honest limitation of not shipping either.
 *
 * **Pages are rasterized on demand, not up front.** A deck is opened by reading
 * its structure only; a page becomes pixels when it is actually shown, and
 * those pixels are released when the deck closes. Pre-rendering every page is
 * the obvious shape and the wrong one: a 60-page deck would put sixty
 * full-viewport bitmaps into memory to show one of them, which is the
 * client-side twin of the decompression bomb PLAN-25 guards against.
 */

/**
 * Hard ceilings on a single rasterized page, independent of viewport or device
 * pixel ratio. 4096 per edge and ~16.7M pixels of area are **iOS Safari's own
 * canvas limits** — past them it does not shrink the drawing, it hands back a
 * blank canvas, so this is a correctness bound on the devices this app targets
 * and not only a memory one.
 */
export const MAX_CANVAS_EDGE = 4096;
export const MAX_CANVAS_AREA = 16_777_216;

/** The CSS size the rasterized page should be displayed at. */
export interface PdfPageRender {
  width: number;
  height: number;
}

export interface PdfDeck {
  pageCount: number;
  /** Rasterize one 1-based page into `canvas`, fitted to `box` CSS pixels. */
  renderPage(
    page: number,
    canvas: HTMLCanvasElement,
    box: { width: number; height: number },
  ): Promise<PdfPageRender>;
  /** Release the worker and the document. */
  destroy(): Promise<void>;
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * Loaded once, lazily, and only when a PDF is actually opened — the same shape
 * `core/markdown/mermaid.ts` already uses for its own heavy dependency, so a
 * deck of markdown never pays for this one.
 */
function pdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((module) => {
    module.GlobalWorkerOptions.workerSrc = workerUrl;
    return module;
  });
  return pdfjsPromise;
}

/**
 * The scale to render at: fit the page into the box, honour the device's pixel
 * ratio for a sharp raster, then clamp to the ceilings above. Returned rather
 * than applied so the bound is testable without a DOM.
 */
export function fitScale(
  page: { width: number; height: number },
  box: { width: number; height: number },
  ratio = 1,
): number {
  if (page.width <= 0 || page.height <= 0) return 1;
  const fit = Math.min(box.width / page.width, box.height / page.height);
  // A box smaller than a pixel (a hidden container, a zero-height frame) would
  // otherwise ask for a zero-size canvas, which throws.
  const wanted = Math.max(fit, 0.01) * Math.max(ratio, 1);
  const byEdge = Math.min(
    MAX_CANVAS_EDGE / (page.width * wanted),
    MAX_CANVAS_EDGE / (page.height * wanted),
    1,
  );
  const byArea = Math.min(
    Math.sqrt(MAX_CANVAS_AREA / (page.width * wanted * page.height * wanted)),
    1,
  );
  return wanted * Math.min(byEdge, byArea);
}

/**
 * Open a PDF from bytes already in memory.
 *
 * Bytes rather than a URL because `loadSource` has to read the response to know
 * it *is* a PDF, and because the CLI's local server is one-shot — it closes
 * after the payload is fetched once, so pdf.js fetching the same address a
 * second time would find nothing there.
 */
export async function loadPdfDeck(data: Uint8Array): Promise<PdfDeck> {
  const lib = await pdfjs();
  // The loading task, not just the document it resolves to: teardown lives on
  // the task (it owns the worker), and the document proxy has no `destroy()`.
  const task = lib.getDocument({ data });
  const doc = await task.promise;

  /**
   * Renders run one at a time. pdf.js rejects a second `render()` on a page
   * whose first is still in flight, and a resize or a zoom step can easily ask
   * for one before the last has finished — so asking is queued rather than
   * guarded against at every call site.
   */
  let queue: Promise<unknown> = Promise.resolve();

  async function rasterize(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    box: { width: number; height: number },
  ): Promise<PdfPageRender> {
    const page = await doc.getPage(pageNumber);
    try {
      const unscaled = page.getViewport({ scale: 1 });
      const scale = fitScale(unscaled, box, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale });

      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('could not get a 2d context for the slide');

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      // The CSS size is the raster divided back out by the pixel ratio: the
      // canvas is deliberately oversampled, and without this it would be drawn
      // at twice its intended size on a retina screen.
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      return { width: canvas.width / ratio, height: canvas.height / ratio };
    } finally {
      // Freed whether or not the render succeeded: the page holds its operator
      // list and fonts otherwise, and a long deck walks through every page.
      page.cleanup();
    }
  }

  return {
    pageCount: doc.numPages,

    renderPage(pageNumber, canvas, box) {
      const run = queue.then(
        () => rasterize(pageNumber, canvas, box),
        () => rasterize(pageNumber, canvas, box),
      );
      // The queue itself must never reject, or one failed page would poison
      // every later one.
      queue = run.catch(() => {});
      return run;
    },

    async destroy() {
      await task.destroy().catch((error: unknown) => {
        // Nothing the presenter can act on, but a worker that fails to go away
        // is exactly the leak this method exists to prevent.
        log.warn(`saga: could not release the pdf document: ${(error as Error).message}`, {
          module: 'saga',
        });
      });
    },
  };
}
