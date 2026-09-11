import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { MAX_CANVAS_AREA, MAX_CANVAS_EDGE, fitScale, loadPdfDeck } from './loadPdfSlides';

/**
 * The one thing that cannot be real here: `?url` is a *bundler* instruction, so
 * outside a build it resolves to a dev-server path (`/@fs/…`) that Node cannot
 * import, and pdf.js's own fallback then fails trying to load the worker from
 * it. Substituting the worker's actual path on disk leaves everything under
 * test — the parse, the page count, the teardown — running for real against a
 * real file. That the built bundle emits a *working* URL here is the plan's
 * mandated spike, and is proven in a real browser by live-verify; a unit test
 * in Node could not prove it either way.
 */
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({
  default: createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
}));

/**
 * A real PDF, not a stub (PLAN-29).
 *
 * Three pages, each with its own text, written by hand into the fixture so the
 * page count being right is a fact about pdf.js parsing a real file rather than
 * about a mock returning the number the test asked for.
 */
const FIXTURE = readFileSync(fileURLToPath(new URL('./__fixtures__/three-pages.pdf', import.meta.url)));

/** US Letter at 72dpi, the fixture's own page box. */
const LETTER = { width: 612, height: 792 };

describe('fitScale (PLAN-29)', () => {
  it('fits the page inside the box, longest side first', () => {
    // A 612×792 page into an 800×400 box is bound by the height.
    expect(fitScale(LETTER, { width: 800, height: 400 })).toBeCloseTo(400 / 792, 10);
  });

  it('multiplies by the device pixel ratio so the raster is not soft', () => {
    const one = fitScale(LETTER, { width: 800, height: 400 }, 1);
    expect(fitScale(LETTER, { width: 800, height: 400 }, 2)).toBeCloseTo(one * 2, 10);
  });

  it('never lets a ratio below 1 shrink the raster below the fit', () => {
    const one = fitScale(LETTER, { width: 800, height: 400 }, 1);
    expect(fitScale(LETTER, { width: 800, height: 400 }, 0.5)).toBeCloseTo(one, 10);
  });

  it('clamps a huge viewport to the maximum edge', () => {
    // 40 000 CSS pixels tall at ratio 3 would want a ~150 000px canvas.
    const scale = fitScale(LETTER, { width: 40_000, height: 40_000 }, 3);
    expect(Math.max(LETTER.width * scale, LETTER.height * scale)).toBeLessThanOrEqual(
      MAX_CANVAS_EDGE + 0.001,
    );
  });

  it('clamps total area too, not only each edge', () => {
    // A very wide, very short page can stay under 4096 per edge and still blow
    // past the area limit — the edge clamp alone would miss this.
    const wide = { width: 20_000, height: 500 };
    const scale = fitScale(wide, { width: 100_000, height: 100_000 }, 4);
    expect(wide.width * scale * (wide.height * scale)).toBeLessThanOrEqual(MAX_CANVAS_AREA + 1);
    expect(wide.width * scale).toBeLessThanOrEqual(MAX_CANVAS_EDGE + 0.001);
  });

  it('refuses to divide by a page with no size', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 800, height: 600 })).toBe(1);
  });

  it('asks for something drawable when the frame has collapsed', () => {
    // A hidden or not-yet-laid-out frame measures zero; a zero-size canvas
    // throws, so the floor matters.
    expect(fitScale(LETTER, { width: 0, height: 0 })).toBeGreaterThan(0);
  });
});

describe('loadPdfDeck (PLAN-29)', () => {
  it('reads a real multi-page PDF and reports one slide per page', async () => {
    const deck = await loadPdfDeck(new Uint8Array(FIXTURE));
    expect(deck.pageCount).toBe(3);
    await deck.destroy();
  });
});
