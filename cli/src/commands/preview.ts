import type { Command } from 'commander';
import { openInBrowser, shouldLaunch } from '../core/browser.js';
import { clientFromOptions } from '../core/client.js';
import {
  DOCUMENT_KINDS,
  hasRenderedPage,
  previewUrl,
  resolveDocument,
} from '../core/documents.js';
import { note, print } from '../core/output.js';

export function registerPreview(program: Command): void {
  program
    .command('preview')
    .description("open a saved document's page in your browser")
    .argument('<slug>', 'the document slug, as the Pensieve shows it')
    .option('--type <kind>', `skip the four-way lookup: ${DOCUMENT_KINDS.join(' | ')}`)
    .option('--no-open', 'print the resolved URL instead of launching a browser')
    // `--no-open` makes commander default `open` to true; it flips to false when
    // the flag is passed.
    .action(async (slug: string, options: { type?: string; open: boolean }, command: Command) => {
      const globals = command.optsWithGlobals();
      const client = clientFromOptions(globals);
      const document = await resolveDocument(client, slug, options.type);
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
