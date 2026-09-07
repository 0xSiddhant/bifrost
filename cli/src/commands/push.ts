import type { Command } from 'commander';
import { clientFromOptions } from '../core/client.js';
import { pushFiles, type UploadRejectionReason } from '../core/files.js';
import { EXIT, formatBytes, note, print } from '../core/output.js';

const WHY: Record<UploadRejectionReason, string> = {
  'too-large': 'over the server’s size cap',
  'blocked-extension': 'that extension is blocked',
  'upload-failed': 'the write failed on the server',
  'folder-conflict': 'the destination is a file, not a folder',
};

export function registerPush(program: Command): void {
  program
    .command('push')
    .description('send one or more files to the bridge (they land in Send, ready to publish)')
    .argument('<files...>', 'local files to send')
    .action(async (files: string[], _options: unknown, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const result = await pushFiles(client, files);

      print(result, (value) => {
        const lines = value.accepted.map(
          (file) =>
            `  ${file.name} → ${file.storedName} (${formatBytes(file.size)})` +
            (file.folder === undefined ? '' : ` in ${file.folder}/`),
        );
        const rejected = value.rejected.map((file) => `  ${file.name} — ${WHY[file.reason]}`);
        return [
          `${value.accepted.length} accepted, ${value.rejected.length} rejected`,
          ...lines,
          ...(rejected.length > 0 ? ['rejected:', ...rejected] : []),
        ].join('\n');
      });

      if (result.accepted.length > 0) {
        note('Open Send on any device to preview, rename, or move them to Downloads.');
      }
      // A partial batch is still a partial failure: the full per-file result is
      // on stdout, and the exit code says not everything landed.
      if (result.rejected.length > 0) process.exitCode = EXIT.failure;
    });
}
