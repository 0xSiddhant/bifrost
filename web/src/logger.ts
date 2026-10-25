import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';

export type Logger = pino.Logger;

export interface WebLoggerOptions {
  level: string;
  logsDir: string;
  retainFiles: number;
  pretty: boolean;
}

/**
 * Why the logs directory cannot be written, or null when it can. Checked
 * before the logger exists: pino-roll fails inside its worker thread, and the
 * process then exits 1 without a word (PLAN-39 found it with a container's
 * `node` user over a root-owned `storage/`), which leaves nothing to go on.
 */
export function logsDirProblem(logsDir: string): string | null {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.accessSync(logsDir, fs.constants.W_OK);
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'error';
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    return (
      `cannot write its logs to ${logsDir} (${code})` +
      (uid === null ? '' : `: it runs as uid ${uid}; make the storage folder writable by it`) +
      ' (in Docker: chown -R 1000 storage on the host)'
    );
  }
}

/**
 * The web host's lines go to the same `storage/logs` archive as the API's, so
 * Grafana sees both processes, under `source: 'web'` (PLAN-36).
 *
 * Its own file series, `app-web.N.log`, never the server's `app.N.log`: two
 * processes appending to and rotating one pino-roll series would fight over
 * the numbering. The name still matches Alloy's `app*.log` glob, and
 * pino-roll's retention only counts files named exactly `<base>.<N>.log`, so
 * neither process prunes the other's. No `current.log` symlink: that one is
 * the server's, and `./bifrost logs` tails it.
 */
export function createWebLogger(options: WebLoggerOptions): Logger {
  const targets: pino.TransportTargetOptions[] = [
    {
      target: 'pino-roll',
      options: {
        file: path.join(options.logsDir, 'app-web'),
        extension: '.log',
        frequency: 'daily',
        size: '20m',
        mkdir: true,
        limit: { count: options.retainFiles, removeOtherLogFiles: true },
      },
      level: 'trace',
    },
  ];
  if (options.pretty) {
    targets.push({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', levelKey: 'logLevel' },
      level: 'trace',
    });
  }
  // Same text-level formatter as the server (see server/src/core/logger): the
  // numeric `level` stays because pino's multi-target router keys on it.
  return pino(
    {
      level: options.level,
      formatters: {
        level: (label: string, number: number) => ({ logLevel: label, level: number }),
      },
    },
    pino.transport({ targets }),
  ).child({ source: 'web' });
}
