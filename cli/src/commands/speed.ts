import type { Command } from 'commander';
import { clientFromOptions } from '../core/client.js';
import {
  formatMbps,
  getNimbusConfig,
  runSpeedTest,
  saveSpeedResult,
  type Phase,
} from '../core/nimbus.js';
import { CliError, note, print } from '../core/output.js';

const PHASE_TEXT: Record<Phase, string> = {
  warmup: 'warming up…',
  ping: 'measuring latency…',
  down: 'measuring download…',
  up: 'measuring upload…',
  saving: 'saving…',
};

export function registerSpeed(program: Command): void {
  program
    .command('speed')
    .description('run a LAN speed test against the bridge and save it to the shared history')
    .option('--mb <size>', 'payload size in MB (default: the server’s own middle option)')
    .action(async (options: { mb?: string }, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const config = await getNimbusConfig(client);

      const testMb = options.mb === undefined ? defaultSize(config.sizes) : Number(options.mb);
      if (!Number.isFinite(testMb) || testMb <= 0) {
        throw new CliError('--mb takes a positive number of megabytes');
      }
      if (testMb > config.maxTestMb) {
        throw new CliError(`--mb is capped at ${config.maxTestMb} on this server`);
      }

      // Ctrl-C during a run would otherwise leave the single-flight lease held
      // until its grace window expires, and the next device would be told a
      // broom is flying that has already landed.
      const releaseOnCancel = (): void => {
        void client
          .voidCall('releasing the speed-test lease', 'POST', '/api/nimbus/release')
          .catch(() => undefined)
          .finally(() => process.exit(130));
      };
      process.once('SIGINT', releaseOnCancel);

      try {
        const reading = await runSpeedTest(client, {
          testMb,
          pingSamples: config.pingSamples,
          onPhase: (phase) => note(PHASE_TEXT[phase]),
        });
        note(PHASE_TEXT.saving);
        const saved = await saveSpeedResult(client, reading);
        print(saved, (value) =>
          [
            `down      ${formatMbps(value.downMbps)} Mbps`,
            `up        ${formatMbps(value.upMbps)} Mbps`,
            `latency   ${value.latencyMs.toFixed(1)} ms`,
            `payload   ${value.testMb} MB`,
          ].join('\n'),
        );
      } finally {
        process.removeListener('SIGINT', releaseOnCancel);
      }
    });
}

/** The middle option the server offers, so the CLI never hardcodes a menu. */
export function defaultSize(sizes: readonly number[]): number {
  if (sizes.length === 0) return 10;
  return sizes[Math.floor(sizes.length / 2)] ?? 10;
}
