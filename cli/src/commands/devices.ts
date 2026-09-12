import type { Command } from 'commander';
import { clientFromOptions } from '../core/client.js';
import { listDevices } from '../core/presence.js';
import {
  accent,
  dim,
  formatWhen,
  heading,
  plural,
  positive,
  print,
  table,
} from '../core/output.js';

export function registerDevices(program: Command): void {
  program
    .command('devices')
    .description('which devices the bridge has seen (read-only)')
    .action(async (_options: unknown, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const devices = await listDevices(client);
      print(devices, (rows) => {
        if (rows.length === 0) return dim('No devices have connected yet.');
        const online = rows.filter((row) => row.online).length;
        return [
          heading('Devices'),
          table(rows, [
            {
              header: 'NAME',
              value: (row) => row.name ?? row.charName ?? row.deviceId,
              style: accent,
            },
            { header: 'DEVICE', value: (row) => row.label, style: dim },
            {
              header: 'STATE',
              value: (row) => (row.online ? 'online' : 'offline'),
              // Green for online only. Offline is dim rather than red: a phone
              // that is simply asleep is not a failure to flag.
              style: (text, row) => (row.online ? positive(text) : dim(text)),
            },
            { header: 'LAST SEEN', value: (row) => formatWhen(row.lastSeen), style: dim },
          ]),
          dim(`${plural(rows.length, 'device')}, ${online} online`),
        ].join('\n');
      });
    });
}
