import type { Command } from 'commander';
import { clientFromOptions } from '../core/client.js';
import { accent, dim, fields, heading, print } from '../core/output.js';

export interface Health {
  ok: boolean;
  uptime: number;
  profile: string;
}

export interface Capabilities {
  profile: string;
  modules: string[];
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('what the bridge says about itself: profile, uptime, loaded modules')
    .action(async (_options: unknown, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const [health, capabilities] = await Promise.all([
        client.json<Health>('reading server health', 'GET', '/api/health'),
        client.json<Capabilities>('reading server capabilities', 'GET', '/api/capabilities'),
      ]);

      print({ host: client.baseUrl, ...health, modules: capabilities.modules }, (value) =>
        [
          heading('Bifrost'),
          fields([
            ['host', accent(value.host)],
            ['profile', value.profile],
            ['uptime', formatUptime(value.uptime)],
            ['modules', `${value.modules.length} loaded`],
          ]),
          dim(`  ${value.modules.join(' · ')}`),
        ].join('\n'),
      );
    });
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86_400);
  const hours = Math.floor((whole % 86_400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${whole % 60}s`;
  return `${whole}s`;
}
