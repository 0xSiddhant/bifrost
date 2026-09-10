import path from 'node:path';
import type { Command } from 'commander';
import { clientFromOptions } from '../core/client.js';
import {
  displayPath,
  findEntry,
  listDownloads,
  localNameFor,
  pullEntry,
  sortForListing,
  type DownloadEntry,
  type PullResult,
} from '../core/files.js';
import {
  accent,
  CliError,
  fileTint,
  dim,
  formatBytes,
  formatWhen,
  heading,
  note,
  ok,
  plural,
  print,
  progress,
  table,
} from '../core/output.js';

export function registerPull(program: Command): void {
  program
    .command('pull')
    .description('list what the bridge is offering, or download files and folders from it')
    .argument('[names...]', 'what to download — files, folders, or both, separated by spaces')
    .option('-l, --list', 'list what is on offer instead of downloading')
    .option('--out <path>', 'where to write it (only with a single name)')
    .action(
      async (names: string[], options: { list?: boolean; out?: string }, command: Command) => {
        const client = clientFromOptions(command.optsWithGlobals());
        const entries = await listDownloads(client);

        if (options.list === true || names.length === 0) {
          printListing(entries);
          return;
        }
        if (options.out !== undefined && names.length > 1) {
          throw new CliError(
            '--out names one destination, so it only works with a single name — ' +
              'drop it and each download lands under its own name here',
          );
        }

        const targets = names.map((name) => findEntry(entries, name));
        const results: PullResult[] = [];
        for (const entry of targets) {
          const destination = options.out ?? path.basename(localNameFor(entry));
          results.push(await pullEntry(client, entry, destination, progress));
        }

        print(results, (rows) => {
          const lines = [heading(`Pulled ${plural(rows.length, 'item')}`)];
          for (const row of rows) {
            const kind = row.type === 'folder' ? dim(' (zipped folder)') : '';
            lines.push(`  ${ok(accent(row.path))} ${dim(formatBytes(row.size))}${kind}`);
          }
          return lines.join('\n');
        });
      },
    );
}

function printListing(entries: readonly DownloadEntry[]): void {
  print(entries, (rows) => {
    if (rows.length === 0) return dim('Downloads is empty.');
    const files = rows.filter((row) => row.type === 'file').length;
    const folders = rows.length - files;
    return [
      heading('Downloads'),
      table(sortForListing(rows), [
        {
          header: 'NAME',
          value: displayPath,
          // The listing puts a folder immediately above its own contents, and
          // that grouping is invisible in a flat column of names. Colouring the
          // folder row is what makes it read as a heading for the rows under it.
          style: (text, row) =>
            row.type === 'folder' ? accent(text) : fileTint(row.name, text),
        },
        {
          header: 'TYPE',
          value: (row) => row.type,
          style: (text, row) => (row.type === 'folder' ? accent(text) : dim(text)),
        },
        {
          header: 'SIZE',
          // A folder's own size is meaningless here — the server reports 0 and
          // the real figure is the sum of its children, which the rows below
          // already carry.
          value: (row) => (row.type === 'folder' ? '—' : formatBytes(row.size)),
          align: 'right',
          style: dim,
        },
        { header: 'MODIFIED', value: (row) => formatWhen(row.mtime), style: dim },
      ]),
      dim(`${plural(files, 'file')}, ${plural(folders, 'folder')}`),
    ].join('\n');
  });
  if (entries.length > 0) note('Pull one with `bifrost pull <name>` — a folder arrives as a .zip.');
}
