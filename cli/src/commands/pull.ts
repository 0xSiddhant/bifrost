import path from 'node:path';
import type { Command } from 'commander';
import { clientFromOptions } from '../core/client.js';
import { displayPath, findDownload, listDownloads, pullFile } from '../core/files.js';
import { formatBytes, formatWhen, note, print, table } from '../core/output.js';

export function registerPull(program: Command): void {
  program
    .command('pull')
    .description('list what the bridge is offering, or download one of it')
    .argument('[name]', 'file to download — `Folder/name` when two folders share a name')
    .option('--out <path>', 'where to write it (default: the file name, in the current folder)')
    .action(async (name: string | undefined, options: { out?: string }, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const entries = await listDownloads(client);

      if (name === undefined) {
        print(entries, (rows) => {
          if (rows.length === 0) return 'Downloads is empty.';
          return table(rows, [
            { header: 'NAME', value: displayPath },
            { header: 'TYPE', value: (row) => row.type },
            {
              header: 'SIZE',
              value: (row) => (row.type === 'folder' ? '—' : formatBytes(row.size)),
              align: 'right',
            },
            { header: 'MODIFIED', value: (row) => formatWhen(row.mtime) },
          ]);
        });
        return;
      }

      const entry = findDownload(entries, name);
      const destination = options.out ?? path.basename(entry.name);
      note(`pulling ${displayPath(entry)} (${formatBytes(entry.size)})…`);
      const size = await pullFile(client, entry, destination);
      print({ name: displayPath(entry), path: destination, size }, (value) =>
        `saved ${value.path} (${formatBytes(value.size)})`,
      );
    });
}
