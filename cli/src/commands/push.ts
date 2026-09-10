import type { Command } from 'commander';
import { clientFromOptions } from '../core/client.js';
import { expandUploadInputs, pushFiles, type UploadRejectionReason } from '../core/files.js';
import {
  accent,
  bad,
  dim,
  EXIT,
  formatBytes,
  heading,
  note,
  ok,
  plural,
  print,
  progress,
} from '../core/output.js';

const WHY: Record<UploadRejectionReason, string> = {
  'too-large': 'over the server’s size cap',
  'blocked-extension': 'that extension is blocked',
  'upload-failed': 'the write failed on the server',
  'folder-conflict': 'the destination is a file, not a folder',
};

export function registerPush(program: Command): void {
  program
    .command('push')
    .description('send files to the bridge — names, folders, or `.` for everything here')
    .argument('<paths...>', 'files and/or folders to send, separated by spaces')
    .option(
      '-d, --dir <name>',
      'put them straight into this Downloads folder (created if missing) instead of Send',
    )
    .action(async (paths: string[], options: { dir?: string }, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const expanded = expandUploadInputs(paths);

      if (expanded.hidden > 0) {
        note(`skipped ${plural(expanded.hidden, 'hidden file')}`);
      }
      if (expanded.nested > 0) {
        note(
          `skipped ${plural(expanded.nested, 'sub-folder')} — Downloads is one level deep, ` +
            'so nested trees are never flattened into it',
        );
      }

      const result = await pushFiles(client, expanded.files, {
        ...(options.dir === undefined ? {} : { folder: options.dir }),
        progress,
      });

      print({ ...result, folder: options.dir ?? null }, (value) => {
        const destination =
          options.dir === undefined
            ? 'Send (staging)'
            : `Downloads/${value.accepted[0]?.folder ?? options.dir}`;
        const lines = [heading(`Pushed to ${destination}`)];

        for (const file of value.accepted) {
          lines.push(`  ${ok(accent(file.storedName))} ${dim(formatBytes(file.size))}`);
        }
        for (const file of value.rejected) {
          lines.push(`  ${bad(file.name)} ${dim(WHY[file.reason])}`);
        }
        lines.push(
          dim(`${plural(value.accepted.length, 'file')} accepted, ${value.rejected.length} rejected`),
        );
        return lines.join('\n');
      });

      // The server sanitizes a folder name silently; the sender is the only one
      // who can notice it changed, so say it once rather than never.
      const landed = result.accepted[0]?.folder;
      if (options.dir !== undefined && landed !== undefined && landed !== options.dir) {
        note(`the folder name was cleaned up to "${landed}"`);
      }
      if (result.accepted.length > 0) {
        note(
          options.dir === undefined
            ? 'Open Send on any device to preview, rename, or move them to Downloads.'
            : 'They are live on Downloads already — every open device just got the banner.',
        );
      }
      // A partial batch is still a partial failure: the full per-file result is
      // on stdout, and the exit code says not everything landed.
      if (result.rejected.length > 0) process.exitCode = EXIT.failure;
    });
}
