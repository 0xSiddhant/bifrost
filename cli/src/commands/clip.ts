import type { Command } from 'commander';
import { clientFromOptions } from '../core/client.js';
import { addClipboard, listClipboard, removeClipboard } from '../core/clipboard.js';
import {
  accent,
  CliError,
  code,
  dim,
  EXIT,
  formatWhen,
  heading,
  note,
  ok,
  plural,
  print,
  table,
} from '../core/output.js';

interface ClipOptions {
  list?: boolean;
  rm?: string;
  code?: boolean;
  lang?: string;
  ttl?: string;
}

export function registerClip(program: Command): void {
  program
    .command('clip')
    .description('read or write Hermes, the clipboard every device on the LAN shares')
    .argument('[text]', 'text to share; omit it to print the most recent entry')
    .option('--list', 'list every entry instead of printing the newest')
    .option('--rm <id>', 'delete one entry')
    .option('--code', 'mark the entry as code rather than prose')
    .option('--lang <lang>', 'language hint for a code entry')
    .option('--ttl <seconds>', 'let the entry expire after this many seconds')
    .action(async (text: string | undefined, options: ClipOptions, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());

      if (options.rm !== undefined) {
        await removeClipboard(client, options.rm);
        print({ removed: options.rm }, (value) => ok(`removed ${accent(value.removed)}`));
        return;
      }

      if (text !== undefined) {
        const ttlSeconds = options.ttl === undefined ? undefined : Number(options.ttl);
        if (ttlSeconds !== undefined && (!Number.isInteger(ttlSeconds) || ttlSeconds < 1)) {
          throw new CliError('--ttl takes a whole number of seconds');
        }
        const entry = await addClipboard(client, {
          text,
          ...(options.code === true ? { kind: 'code' as const } : {}),
          ...(options.lang === undefined ? {} : { lang: options.lang }),
          ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
        });
        print(entry, (value) => ok(`shared as ${accent(value.id)}`));
        note('It is on every open Hermes page already.');
        return;
      }

      const entries = await listClipboard(client);
      if (options.list === true) {
        print(entries, (rows) => {
          if (rows.length === 0) return dim('The clipboard is empty.');
          return [
            heading('Hermes'),
            table(rows, [
              { header: 'ID', value: (row) => row.id, style: dim },
              {
                header: 'KIND',
                value: (row) => row.kind,
                // Echoes the colour its TEXT gets, so the label and the content
                // agree instead of the label being decoration of its own.
                style: (text, row) => (row.kind === 'code' ? code(text) : dim(text)),
              },
              { header: 'WHEN', value: (row) => formatWhen(row.createdAt), style: dim },
              {
                header: 'TEXT',
                value: (row) => oneLine(row.text),
                // Code and links are the two things worth spotting without
                // reading; prose stays the terminal's own colour, because a
                // listing where every row is coloured distinguishes nothing.
                style: (text, row) => {
                  if (row.kind === 'code') return code(text);
                  return /^[a-z][a-z0-9+.-]*:\/\//i.test(row.text) ? accent(text) : text;
                },
              },
            ]),
            dim(plural(rows.length, 'entry', 'entries')),
          ].join('\n');
        });
        return;
      }

      // The listing is newest-first, so a bare `bifrost clip` is "give me what I
      // just copied on the other device" — the read half of the round trip.
      const newest = entries[0];
      if (newest === undefined) {
        throw new CliError('the clipboard is empty', EXIT.notFound);
      }
      print(newest, (value) => value.text);
    });
}

/** Table cells are one line; the full text is what `--json` and a bare `clip` give. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}
