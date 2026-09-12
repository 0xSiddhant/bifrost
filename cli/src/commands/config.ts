import type { Command } from 'commander';
import { configPath, readConfig, updateConfig } from '../core/config.js';
import { normalizeHost, resolveBaseUrl } from '../core/discover.js';
import { accent, dim, fields, heading, ok, print } from '../core/output.js';

export function registerConfig(program: Command): void {
  const config = program.command('config').description('the CLI’s own settings');

  config
    .command('show')
    .description('print the config file’s location and contents')
    .action(() => {
      const stored = readConfig();
      const { baseUrl, source } = resolveBaseUrl(undefined, stored.host);
      print(
        { path: configPath(), host: baseUrl, hostSource: source, deviceId: stored.deviceId ?? null },
        (value) =>
          [
            heading('CLI config'),
            fields([
              ['file', value.path],
              ['host', `${accent(value.host)} ${dim(`(${value.hostSource})`)}`],
              ['device id', value.deviceId ?? '—'],
            ]),
          ].join('\n'),
      );
    });

  config
    .command('set-host')
    .description('save the bridge’s address so bare invocations find it')
    .argument('<address>', 'bifrost.local:4646, 192.168.1.20, http://…')
    .action((address: string) => {
      const host = normalizeHost(address);
      updateConfig({ host });
      print({ host, path: configPath() }, (value) => ok(`host set to ${accent(value.host)}`));
    });
}
