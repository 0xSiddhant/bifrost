import type { Command } from 'commander';
import { openInBrowser, shouldLaunch } from '../core/browser.js';
import { clientFromOptions } from '../core/client.js';
import {
  DOCUMENT_KINDS,
  hasRenderedPage,
  previewUrl,
  resolveDocument,
} from '../core/documents.js';
import { serveFileOnce } from '../core/localServe.js';
import { looksLikeFilePath, PREVIEW_DESTINATIONS, routeLocalFile } from '../core/preview.js';
import { note, print } from '../core/output.js';

/**
 * `preview` opens the best available view of something, in a browser.
 *
 * Two shapes share the command because they are the same request from a
 * person's side — "show me this" — and differ only in where the bytes are:
 * a **saved document** is addressed by slug and already lives on the bridge
 * (PLAN-27), while a **local file** never left this machine and has to be
 * handed over through a one-shot loopback server (PLAN-28).
 *
 * `--type` therefore means the document *kind* for a slug and the *destination*
 * for a file. They are validated in their own branches and never mix.
 */
export function registerPreview(program: Command): void {
  program
    .command('preview')
    .description("open a saved document's page, or a local file, in your browser")
    .argument('<target>', 'a document slug as the Pensieve shows it, or a path to a local file')
    .option(
      '--type <kind>',
      `for a slug: ${DOCUMENT_KINDS.join(' | ')}. for a file: ${PREVIEW_DESTINATIONS.join(' | ')}`,
    )
    .option('--no-open', 'print the resolved URL instead of launching a browser')
    // `--no-open` makes commander default `open` to true; it flips to false when
    // the flag is passed.
    .action(async (target: string, options: { type?: string; open: boolean }, command: Command) => {
      const globals = command.optsWithGlobals();
      const client = clientFromOptions(globals);

      if (looksLikeFilePath(target)) {
        // Both validations happen before anything is opened: an unusable
        // extension or destination must cost a sentence, not a stray server.
        const destination = routeLocalFile(target, options.type);
        const payload = await serveFileOnce(target, { origin: client.baseUrl });
        const url = `${client.baseUrl}${destination.clientPath(payload.url)}`;

        if (!shouldLaunch(!options.open)) {
          // Nothing is going to fetch it, so the server would only sit there
          // until its own timeout.
          payload.close();
          note('the file is not served in --no-open mode; the printed URL will not resolve');
          print({ file: target, type: destination.id, url }, (value) => value.url);
          return;
        }

        await openInBrowser(url);
        print({ file: target, type: destination.id, url }, (value) => value.url);
        // The command owns the file's only door, so it stays up until the page
        // has actually taken the bytes — then closes itself.
        await payload.finished;
        return;
      }

      const document = await resolveDocument(client, target, options.type);
      const url = previewUrl(client.baseUrl, document);

      if (!hasRenderedPage(document.kind)) {
        note(
          `${document.kind} has no rendered page yet — this is its raw content URL, ` +
            'which a browser renders readably.',
        );
      }
      if (shouldLaunch(!options.open)) {
        await openInBrowser(url);
      }
      print({ slug: document.slug, kind: document.kind, url }, (value) => value.url);
    });
}
