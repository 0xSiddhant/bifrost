import fs from 'node:fs';
import type { Command } from 'commander';
import { clientFromOptions } from '../core/client.js';
import { DOCUMENT_KINDS, resolveDocument } from '../core/documents.js';
import { accent, note, ok, print } from '../core/output.js';

export function registerOpen(program: Command): void {
  program
    .command('open')
    .description('print a saved document (Runestone, Edda, Groot or Atlas) by its slug')
    .argument('<slug>', 'the document slug, as the Pensieve shows it')
    .option('--type <kind>', `skip the four-way lookup: ${DOCUMENT_KINDS.join(' | ')}`)
    .option('--out <file>', 'write the document to a file instead of stdout')
    .action(async (slug: string, options: { type?: string; out?: string }, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const document = await resolveDocument(client, slug, options.type);

      if (options.out !== undefined) {
        fs.writeFileSync(options.out, document.body);
        print({ slug: document.slug, kind: document.kind, path: options.out }, (value) =>
          ok(`saved ${value.kind} ${value.slug} to ${accent(value.path)}`),
        );
        return;
      }

      note(`${document.kind} · ${document.slug}`);
      print({ slug: document.slug, kind: document.kind, content: document.body }, (value) =>
        value.content,
      );
    });
}
