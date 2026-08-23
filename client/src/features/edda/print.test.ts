// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { printHtmlDocument, PRINT_CLEANUP_MS } from './print';

const DOC = '<!doctype html><html><head><title>T</title></head><body><p>hi</p></body></html>';

const frames = () => document.querySelectorAll('iframe');

/**
 * jsdom has no printer: `window.print` is one of its not-implemented members.
 * Replacing it on the frame's own window is also the hook for "the browser
 * never delivers afterprint", which is the case the timeout exists for.
 */
function stubPrint(onPrint: (view: Window) => void): void {
  const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  if (!original?.get) throw new Error('no contentWindow getter to wrap');
  const get = original.get;
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get(this: HTMLIFrameElement) {
      const view = get.call(this) as (Window & { print: () => void }) | null;
      if (view) {
        view.print = () => onPrint(view);
        // jsdom has no focus either, and its "not implemented" notice is noise.
        view.focus = () => undefined;
      }
      return view;
    },
  });
  restore = () => Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', original);
}

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  document.body.innerHTML = '';
});

describe('printHtmlDocument', () => {
  it('prints the export document off-screen and removes the frame on afterprint', async () => {
    let printedFrom: HTMLIFrameElement | null = null;
    // jsdom never parses srcdoc into the child document, so the assertion is on
    // what the frame was handed and where it sits; that the browser renders and
    // prints it is a live-verify claim, not a jsdom one.
    stubPrint((view) => {
      printedFrom = document.querySelector('iframe');
      view.dispatchEvent(new Event('afterprint'));
    });

    await printHtmlDocument(DOC);

    expect(printedFrom).not.toBeNull();
    const frame = printedFrom as unknown as HTMLIFrameElement;
    expect(frame.srcdoc).toBe(DOC);
    expect(frame.style.position).toBe('fixed');
    expect(frame.style.left).toBe('-10000px');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frames()).toHaveLength(0);
  });

  it('removes the iframe on a timeout when afterprint never arrives', async () => {
    stubPrint(() => {
      /* a browser that silently never fires afterprint */
    });

    await printHtmlDocument(DOC, 20);
    expect(frames()).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(frames()).toHaveLength(0);
  });

  it('leaves nothing behind after two exports', async () => {
    stubPrint((view) => view.dispatchEvent(new Event('afterprint')));
    await printHtmlDocument(DOC);
    await printHtmlDocument(DOC);
    expect(frames()).toHaveLength(0);
  });

  it('removes the iframe when print() itself throws', async () => {
    stubPrint(() => {
      throw new Error('blocked');
    });

    await expect(printHtmlDocument(DOC)).rejects.toThrow('blocked');
    expect(frames()).toHaveLength(0);
  });

  it('waits long enough that an open print dialog cannot outlive the fallback', () => {
    // The timer starts after print() returns, and print() blocks on the dialog
    // in every desktop browser — this is the belt on top of that brace.
    expect(PRINT_CLEANUP_MS).toBeGreaterThanOrEqual(10_000);
  });
});
