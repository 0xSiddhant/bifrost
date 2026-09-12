/**
 * What pdf.js needs from Node that this repo's Node does not have (PLAN-29).
 *
 * `pdfjs-dist@6` declares `engines: { node: ">=22.13.0 || >=24" }`, and Bifrost
 * builds and tests on Node 20 (`engines: ">=20"`, and `node-version: 20` in
 * `.github/workflows/ci.yml`). The `legacy/` build lowers the *browser* floor —
 * it bundles core-js and polyfills `Promise.try` — and deliberately does not
 * lower the Node one: there is no `es.promise.with-resolvers` in that bundle,
 * so `Promise.withResolvers`, which `PDFDocumentLoadingTask` calls on every
 * construction, is simply assumed to be native. On Node 20 it is not.
 *
 * **This changes nothing about which browsers can present a PDF**, which is the
 * only reason it is acceptable to shim here rather than raise the repo's Node
 * floor for a dependency the server never loads: `Promise.withResolvers` is
 * Chrome 119, Safari 17.4 and Firefox 121, all *earlier* than the `Promise.try`
 * support the `legacy/` build already exists to paper over. So the browser floor
 * is unchanged by this, and no shipped code path goes near this function — Vite
 * never bundles it, because only the tests import it.
 *
 * Call it before the first `loadPdfDeck`, which is when pdf.js is actually
 * imported; the module itself is loaded lazily, so the top of a test body is
 * early enough.
 */

interface PromiseWithResolvers {
  withResolvers?<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
}

export function polyfillPromiseWithResolvers(): void {
  const target = Promise as PromiseConstructor & PromiseWithResolvers;
  if (typeof target.withResolvers === 'function') return;

  target.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
